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
const PORT = Number(process.env.PORT || 3001)
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

app.use(cors())
// The client now sends a compressed JPEG (~1 MB max), so 8 MB is ample and
// keeps the request body limit tight.
app.use(express.json({ limit: '8mb' }))

const requiredEnv = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'MAIL_FROM'
]

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(`[server] Missing env var: ${key}`)
  }
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
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

let supabase = null
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  } catch (err) {
    console.warn('[server] Supabase init warning:', err.message)
  }
}

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

    // Step 1: Send via Nodemailer SMTP
    const subject = `Your Vibrant Gujarat Memory • ${placeName}`
    console.log(`\n🚀 [SMTP DISPATCH] Sending email via ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}...`)
    console.log(`   • From   : ${process.env.MAIL_FROM}`)
    console.log(`   • To     : ${maskEmail(recipient)}`)
    console.log(`   • Subject: ${subject}`)

    const mailOptions = {
      from: process.env.MAIL_FROM,
      to: recipient,
      subject,
      text: `Kem Chho! Thank you for visiting the Vibrant Gujarat AI Photo Booth. Your souvenir photo from ${placeName} is attached. Padharo Gujarat!`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #0c1222; color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #ea580c;">
          <div style="background: linear-gradient(135deg, #ea580c 0%, #f59e0b 50%, #0d9488 100%); padding: 32px 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 26px; letter-spacing: 1px; color: #ffffff;">VIBRANT GUJARAT</h1>
            <p style="margin: 6px 0 0; font-size: 14px; opacity: 0.95; color: #ffffff; font-weight: 500;">AI PHOTO BOOTH SOUVENIR</p>
          </div>
          <div style="padding: 28px 24px;">
            <h2 style="margin-top: 0; color: #fbbf24; font-size: 20px;">Kem Chho! Greetings from Gujarat!</h2>
            <p style="font-size: 15px; line-height: 1.6; color: #e2e8f0;">
              Thank you for capturing your special moment with the <strong>${placeName}</strong> virtual backdrop. We hope this memory inspires your next journey to the Land of Legends!
            </p>
            <div style="background: rgba(255, 255, 255, 0.05); padding: 16px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #ea580c;">
              <p style="margin: 0; font-size: 14px; color: #cbd5e1;">
                <strong>Attached:</strong> Your high-definition photo keepsake with authentic Gujarat framing.
              </p>
            </div>
            <p style="font-size: 14px; color: #94a3b8; margin-top: 24px; text-align: center;">
              <em>"Kuchh din toh gujaro Gujarat mein!"</em><br/>
              ગરવી ગુજરાત • Proudly Created with AI Virtual Reality
            </p>
          </div>
          <div style="background: #070b14; padding: 16px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid rgba(255, 255, 255, 0.08);">
            © ${new Date().getFullYear()} Vibrant Gujarat Tourism • AI Photo Booth
          </div>
        </div>
      `,
      attachments: [
        {
          filename: attachmentFilename,
          content: imageBuffer,
          contentType: parsedImage.mimeType
        }
      ]
    }

    const info = await transporter.sendMail(mailOptions)

    const totalElapsed = Date.now() - startTime
    console.log(`✅ [SMTP SUCCESS] Accepted by mail server in ${totalElapsed}ms`)
    console.log(`   • Message ID : ${info.messageId}`)
    console.log(`   • Accepted   : ${info.accepted?.length || 0} recipient(s)`)
    if (info.rejected && info.rejected.length > 0) {
      console.warn(`   • Rejected   : ${info.rejected.length} recipient(s)`)
    }
    console.log('═'.repeat(65) + '\n')

    // Respond as soon as SMTP accepts the message. The Supabase write happens
    // in the background so the visitor never waits on a database round-trip.
    res.status(200).json({
      message: 'Photo sent successfully!',
      messageId: info.messageId,
      dbStatus: 'queued'
    })

    saveEmailRecord(recipient, placeName).catch((err) => {
      console.error('[DATABASE] Background save failed:', err.message)
    })
  } catch (error) {
    const totalElapsed = Date.now() - startTime
    console.error(`\n💥 [EMAIL DISPATCH FAILED] (${totalElapsed}ms)`)
    console.error(`   • Error Message : ${error.message}`)
    if (error.code) console.error(`   • Error Code    : ${error.code}`)
    if (error.response) console.error(`   • SMTP Response : ${error.response}`)
    console.error(`   • Stack Trace   :`, error.stack)
    console.log('═'.repeat(65) + '\n')

    if (res.headersSent) return
    return res.status(500).json({ message: 'Failed to send email. Check SMTP settings.' })
  }
})

app.listen(PORT, () => {
  console.log(`[server] Vibrant Gujarat AI Photo Booth running at http://localhost:${PORT}`)
})
