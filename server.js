import express from 'express'
import cors from 'cors'
import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import dns from 'node:dns'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

// Prefer IPv4 for outbound SMTP. Broken/unreachable IPv6 routes are a common
// cause of 20-30s stalls when connecting to mail servers.
dns.setDefaultResultOrder('ipv4first')

const app = express()
app.disable('x-powered-by')
// Render (and most hosts) terminate TLS in front of the app, so the real
// client IP arrives in X-Forwarded-For.
app.set('trust proxy', 1)
const PORT = Number(process.env.PORT || 3001)
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Comma-separated list of browser origins allowed to call this API, e.g.
// "https://photo-booth.vercel.app,https://booth.gujarattourism.com".
// Empty means "allow any origin", which is only meant for local development.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)

const LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

const corsOptions = {
  origin(origin, callback) {
    // Same-origin and non-browser requests (health checks, curl) send no Origin.
    if (!origin) return callback(null, true)

    const normalized = origin.replace(/\/+$/, '')
    if (
      ALLOWED_ORIGINS.length === 0 ||
      ALLOWED_ORIGINS.includes('*') ||
      ALLOWED_ORIGINS.includes(normalized) ||
      LOCAL_ORIGIN_REGEX.test(normalized)
    ) {
      return callback(null, true)
    }

    console.warn(`[server] Blocked request from origin: ${origin}`)
    return callback(null, false)
  }
}

app.use(cors(corsOptions))
// The client now sends a compressed JPEG (~1 MB max), so 8 MB is ample and
// keeps the request body limit tight.
app.use(express.json({ limit: '8mb' }))

// ---------------------------------------------------------------------------
// Email transport
// The Brevo HTTP API is the default because most PaaS hosts (Render's free
// tier, for example) block outbound SMTP ports 25/465/587. SMTP stays as a
// fallback so local development can keep using an app password.
// ---------------------------------------------------------------------------
const parseMailFrom = (value) => {
  const raw = String(value || '').trim()
  const match = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>$/)
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() }
  }
  return { name: '', email: raw }
}

const EMAIL_API_KEY = (process.env.EMAIL_API_KEY || '').trim()
const EMAIL_API_URL = (process.env.EMAIL_API_URL || 'https://api.brevo.com/v3/smtp/email').trim()
const EMAIL_API_TIMEOUT_MS = Number(process.env.EMAIL_API_TIMEOUT_MS || 20000)

const parsedMailFrom = parseMailFrom(process.env.MAIL_FROM)
const MAIL_FROM_ADDRESS = (process.env.MAIL_FROM_ADDRESS || '').trim() || parsedMailFrom.email
const MAIL_FROM_NAME = (process.env.MAIL_FROM_NAME || '').trim() || parsedMailFrom.name || 'Gujarat Tourism'

// A Brevo key plus a sender address is all the HTTP API needs.
const useEmailApi = Boolean(EMAIL_API_KEY && MAIL_FROM_ADDRESS)

const requiredEnv = useEmailApi
  ? ['EMAIL_API_KEY']
  : ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(`[server] Missing env var: ${key}`)
  }
}

if (useEmailApi && !MAIL_FROM_ADDRESS) {
  console.warn('[server] Missing env var: MAIL_FROM_ADDRESS (or a MAIL_FROM containing an address)')
}

console.log(
  `[server] Email transport: ${useEmailApi ? 'Brevo HTTP API' : 'SMTP'}`
)

// Lightweight in-memory rate limit. The email endpoint is public once the
// frontend is hosted separately, so this protects the SMTP account from abuse.
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000)
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 5)
const rateBuckets = new Map()

const getClientIp = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown'
}

const isRateLimited = (key) => {
  const now = Date.now()
  const recent = (rateBuckets.get(key) || []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS)

  if (recent.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, recent)
    return true
  }

  recent.push(now)
  rateBuckets.set(key, recent)

  // Keep the map from growing forever on a long-running instance.
  if (rateBuckets.size > 5000) {
    for (const [bucketKey, times] of rateBuckets) {
      if (times.every((time) => now - time >= RATE_LIMIT_WINDOW_MS)) {
        rateBuckets.delete(bucketKey)
      }
    }
  }

  return false
}

const transporter = nodemailer.createTransport({
  // Reuse the SMTP/TLS connection between sends instead of reconnecting
  // (saves ~1-3s per email).
  pool: true,
  maxConnections: 1,
  maxMessages: 100,
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  family: 4,
  // Fail fast instead of hanging for nodemailer's 120s default.
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

// Brevo REST API. Attachments are sent as base64, which the provider accepts
// directly, so the image never has to be decoded and re-encoded.
const sendViaEmailApi = async ({ to, subject, text, html, attachment }) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EMAIL_API_TIMEOUT_MS)

  try {
    const response = await fetch(EMAIL_API_URL, {
      method: 'POST',
      headers: {
        'api-key': EMAIL_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        sender: { name: MAIL_FROM_NAME, email: MAIL_FROM_ADDRESS },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html,
        attachment: attachment
          ? [{ name: attachment.filename, content: attachment.base64Data }]
          : undefined
      }),
      signal: controller.signal
    })

    const rawBody = await response.text()
    let data = {}
    try {
      data = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      data = { raw: rawBody }
    }

    if (!response.ok) {
      const detail = data?.message || data?.error || data?.raw || `HTTP ${response.status}`
      const error = new Error(`Email API rejected the message: ${detail}`)
      error.code = `HTTP_${response.status}`
      throw error
    }

    return { messageId: data?.messageId || null, transport: 'brevo' }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Email API timed out after ${EMAIL_API_TIMEOUT_MS / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

const sendViaSmtp = async ({ to, subject, text, html, attachment }) => {
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || `${MAIL_FROM_NAME} <${MAIL_FROM_ADDRESS}>`,
    to,
    subject,
    text,
    html,
    attachments: attachment
      ? [{ filename: attachment.filename, content: attachment.buffer, contentType: attachment.mimeType }]
      : []
  })

  return {
    messageId: info.messageId,
    transport: 'smtp',
    accepted: info.accepted,
    rejected: info.rejected
  }
}

const sendEmail = (options) => (useEmailApi ? sendViaEmailApi(options) : sendViaSmtp(options))

let supabase = null
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  } catch (err) {
    console.warn('[server] Supabase init warning:', err.message)
  }
}

// Health endpoint for the host's health check / uptime monitoring.
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    supabase: Boolean(supabase),
    emailTransport: useEmailApi ? 'brevo' : 'smtp'
  })
})

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isValidEmail = (value) =>
  typeof value === 'string' && value.length <= 254 && EMAIL_REGEX.test(value)

// Only log a masked recipient so visitor PII never ends up in server logs.
const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return ''
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 2)}***@${domain}`
}

const parseImageDataUrl = (dataUrl) => {
  if (typeof dataUrl !== 'string') return null
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return null

  const mimeType = match[1].toLowerCase()
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) return null

  return {
    mimeType,
    base64Data: match[2]
  }
}

const saveEmailRecord = async (email, backgroundName = 'Gujarat Landmark') => {
  if (!supabase) {
    console.warn('⚠️  [DATABASE] Supabase is not initialized. Skipping database record.')
    return { success: false, reason: 'Supabase client not initialized' }
  }

  // No count query and no email_frequency anymore: a single insert is all we need.
  const payload = {
    email,
    background_name: backgroundName
  }

  try {
    const { data: insertedData, error: insertError } = await supabase
      .from('emails')
      .insert(payload)
      .select('id, background_name')

    if (insertError) {
      console.error(`❌ [DATABASE ERROR] Failed to save record: ${insertError.message}`)
      return { success: false, error: insertError.message }
    }

    console.log('✅ [DATABASE SUCCESS] Visitor record saved.')
    return { success: true, record: insertedData?.[0] || null }
  } catch (err) {
    console.error('❌ [DATABASE ERROR] Exception during insert:', err.message)
    return { success: false, error: err.message }
  }
}

app.post('/api/send-email', async (req, res) => {
  const clientIp = getClientIp(req)
  if (isRateLimited(clientIp)) {
    console.warn(`⚠️  [RATE LIMIT] Too many requests from ${clientIp}`)
    return res.status(429).json({ message: 'Too many requests. Please try again in a few minutes.' })
  }

  const startTime = Date.now()
  const timestamp = new Date().toLocaleString('en-US', { timeZoneName: 'short' })

  console.log('\n' + '═'.repeat(65))
  console.log(`📧 [EMAIL REQUEST RECEIVED]  ${timestamp}`)
  console.log('═'.repeat(65))

  try {
    const { toEmail, imageDataUrl, landmarkName, backgroundName } = req.body || {}
    const recipient = typeof toEmail === 'string' ? toEmail.trim() : ''
    const placeName = String(backgroundName || landmarkName || 'Vibrant Gujarat').slice(0, 120)

    console.log(`📋 [REQUEST DETAILS]`)
    console.log(`   • Recipient Email : ${maskEmail(recipient) || '(none provided)'}`)
    console.log(`   • Background Place: ${placeName}`)

    if (!isValidEmail(recipient) || !imageDataUrl) {
      console.warn(`⚠️  [REQUEST REJECTED] Invalid fields: validEmail=${isValidEmail(recipient)}, hasImage=${Boolean(imageDataUrl)}`)
      console.log('═'.repeat(65) + '\n')
      return res.status(400).json({ message: 'A valid toEmail and imageDataUrl are required.' })
    }

    const parsedImage = parseImageDataUrl(imageDataUrl)
    if (!parsedImage) {
      console.warn(`⚠️  [REQUEST REJECTED] Invalid or unsupported imageDataUrl format.`)
      console.log('═'.repeat(65) + '\n')
      return res.status(400).json({ message: 'Invalid image format. Use JPEG, PNG or WebP.' })
    }

    const imageBuffer = Buffer.from(parsedImage.base64Data, 'base64')
    if (imageBuffer.length === 0) {
      console.warn(`⚠️  [REQUEST REJECTED] Empty image payload.`)
      console.log('═'.repeat(65) + '\n')
      return res.status(400).json({ message: 'Invalid image format.' })
    }

    const sizeKB = (imageBuffer.length / 1024).toFixed(1)
    const sizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(2)
    const attachmentExt = parsedImage.mimeType === 'image/jpeg' ? 'jpg' : parsedImage.mimeType.split('/')[1]
    const attachmentFilename = `vibrant-gujarat-${Date.now()}.${attachmentExt}`

    console.log(`   • Attachment MIME : ${parsedImage.mimeType}`)
    console.log(`   • Attachment File : ${attachmentFilename}`)
    console.log(`   • Attachment Size : ${sizeKB} KB (${sizeMB} MB)`)

    const subject = `Your Vibrant Gujarat Memory • ${placeName}`
    const transportLabel = useEmailApi
      ? `Brevo HTTP API (${EMAIL_API_URL})`
      : `SMTP (${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587})`

    console.log(`\n🚀 [DISPATCH] Sending email via ${transportLabel}...`)
    console.log(`   • From   : ${MAIL_FROM_NAME} <${MAIL_FROM_ADDRESS}>`)
    console.log(`   • To     : ${maskEmail(recipient)}`)
    console.log(`   • Subject: ${subject}`)

    const textBody = `Greetings from Gujarat Tourism!

Thank you for visiting our stall and taking the time to explore the incredible experiences Gujarat has to offer. It was a pleasure having you with us, and we hope you enjoyed discovering the vibrant spirit of Gujarat.

As a token of the wonderful memories created, please find attached your selfie taken at our stall. We hope it brings a smile to your face and reminds you of Gujarat’s rich heritage, colourful traditions, architectural marvels, and warm hospitality.

If this picture has inspired you to discover more, we invite you to experience Gujarat beyond the stall. From the timeless beauty of the Rann of Kutch and the majestic Statue of Unity to ancient temples, vibrant festivals, wildlife encounters, and pristine coastlines, Gujarat has something extraordinary waiting for you.

Come, explore the land of legends, culture, and endless discoveries. We look forward to welcoming you to Gujarat soon!

Warm regards,
Gujarat Tourism`

    const htmlBody = `
        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #222222;">
          <p>Greetings from Gujarat Tourism!</p>
          <p>Thank you for visiting our stall and taking the time to explore the incredible experiences Gujarat has to offer. It was a pleasure having you with us, and we hope you enjoyed discovering the vibrant spirit of Gujarat.</p>
          <p>As a token of the wonderful memories created, please find attached your selfie taken at our stall. We hope it brings a smile to your face and reminds you of Gujarat’s rich heritage, colourful traditions, architectural marvels, and warm hospitality.</p>
          <p>If this picture has inspired you to discover more, we invite you to experience Gujarat beyond the stall. From the timeless beauty of the Rann of Kutch and the majestic Statue of Unity to ancient temples, vibrant festivals, wildlife encounters, and pristine coastlines, Gujarat has something extraordinary waiting for you.</p>
          <p>Come, explore the land of legends, culture, and endless discoveries. We look forward to welcoming you to Gujarat soon!</p>
          <p>Warm regards,<br />Gujarat Tourism</p>
        </div>
      `

    const result = await sendEmail({
      to: recipient,
      subject,
      text: textBody,
      html: htmlBody,
      attachment: {
        filename: attachmentFilename,
        base64Data: parsedImage.base64Data,
        mimeType: parsedImage.mimeType,
        buffer: imageBuffer
      }
    })

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`✅ [EMAIL SENT] Accepted by ${result.transport} in ${elapsedSeconds}s`)
    console.log(`   • Message ID : ${result.messageId || '(not returned)'}`)
    if (result.accepted) {
      console.log(`   • Accepted   : ${result.accepted.length} recipient(s)`)
    }
    if (result.rejected && result.rejected.length > 0) {
      console.warn(`   • Rejected   : ${result.rejected.length} recipient(s)`)
    }
    console.log('═'.repeat(65) + '\n')

    // Respond as soon as the provider accepts the message. The Supabase write
    // happens in the background so the visitor never waits on a DB round-trip.
    res.status(200).json({
      message: 'Photo sent successfully!',
      messageId: result.messageId,
      dbStatus: 'queued'
    })

    saveEmailRecord(recipient, placeName).catch((err) => {
      console.error('[DATABASE] Background save failed:', err.message)
    })
  } catch (error) {
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2)
    console.error(`\n💥 [EMAIL DISPATCH FAILED] (${elapsedSeconds}s)`)
    console.error(`   • Error Message : ${error.message}`)
    if (error.code) console.error(`   • Error Code    : ${error.code}`)
    if (error.response) console.error(`   • SMTP Response : ${error.response}`)
    console.error(`   • Stack Trace   :`, error.stack)
    console.log('═'.repeat(65) + '\n')

    if (res.headersSent) return
    return res.status(500).json({
      message: useEmailApi
        ? 'Failed to send email. Please try again in a moment.'
        : 'Failed to send email. Check SMTP settings.'
    })
  }
})

app.listen(PORT, () => {
  console.log(`[server] Vibrant Gujarat Photo Booth running at http://localhost:${PORT}`)
})
