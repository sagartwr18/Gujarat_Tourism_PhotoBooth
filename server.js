import express from 'express'
import cors from 'cors'
import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT || 3001)
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

app.use(cors())
app.use(express.json({ limit: '25mb' }))

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
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
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

const parseImageDataUrl = (dataUrl) => {
  const match = dataUrl?.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) return null
  return {
    mimeType: match[1],
    base64Data: match[2]
  }
}

const saveEmailRecord = async (email, backgroundName = 'Gujarat Landmark') => {
  if (!supabase) {
    console.warn('⚠️  [DATABASE] Supabase is not initialized. Skipping database record.')
    return { success: false, reason: 'Supabase client not initialized' }
  }

  console.log(`\n🔍 [DATABASE] Checking existing email count for: ${email}`)
  let count = 0
  let countError = null

  try {
    const countResult = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
    count = countResult.count
    countError = countResult.error
  } catch (networkError) {
    const detail = networkError?.cause?.message || networkError?.message || 'Unknown network error'
    console.error(`❌ [DATABASE ERROR] Failed to reach Supabase: ${detail}`)
    return { success: false, error: detail }
  }

  if (countError) {
    console.error(`❌ [DATABASE ERROR] Failed to retrieve email frequency: ${countError.message}`)
    return { success: false, error: countError.message }
  }

  const nextFrequency = (count || 0) + 1
  console.log(`📊 [DATABASE] Prior record count for user: ${count || 0} → New frequency assigned: ${nextFrequency}`)

  const payload = {
    email,
    email_frequency: nextFrequency,
    background_name: backgroundName
  }

  console.log(`💾 [DATABASE] Inserting record into 'emails' table:`)
  console.log(JSON.stringify(payload, null, 2))

  try {
    const { data: insertedData, error: insertError } = await supabase
      .from('emails')
      .insert(payload)
      .select()

    if (insertError) {
      console.error(`❌ [DATABASE ERROR] Failed to save record: ${insertError.message}`)
      return { success: false, error: insertError.message }
    }

    const savedRecord = insertedData?.[0] || payload
    console.log(`✅ [DATABASE SUCCESS] Record saved in Supabase:`)
    console.log(JSON.stringify(savedRecord, null, 2))
    return { success: true, record: savedRecord }
  } catch (err) {
    console.error(`❌ [DATABASE ERROR] Exception during insert:`, err.message)
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
    const placeName = backgroundName || landmarkName || 'Vibrant Gujarat'

    console.log(`📋 [REQUEST DETAILS]`)
    console.log(`   • Recipient Email : ${toEmail || '(none provided)'}`)
    console.log(`   • Background Place: ${placeName}`)

    if (!toEmail || !imageDataUrl) {
      console.warn(`⚠️  [REQUEST REJECTED] Missing fields: toEmail=${Boolean(toEmail)}, imageDataUrl=${Boolean(imageDataUrl)}`)
      console.log('═'.repeat(65) + '\n')
      return res.status(400).json({ message: 'toEmail and imageDataUrl are required.' })
    }

    const parsedImage = parseImageDataUrl(imageDataUrl)
    if (!parsedImage) {
      console.warn(`⚠️  [REQUEST REJECTED] Invalid imageDataUrl format provided.`)
      console.log('═'.repeat(65) + '\n')
      return res.status(400).json({ message: 'Invalid image format.' })
    }

    const imageBuffer = Buffer.from(parsedImage.base64Data, 'base64')
    const sizeKB = (imageBuffer.length / 1024).toFixed(1)
    const sizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(2)
    const attachmentFilename = `vibrant-gujarat-${Date.now()}.png`

    console.log(`   • Attachment MIME : ${parsedImage.mimeType}`)
    console.log(`   • Attachment File : ${attachmentFilename}`)
    console.log(`   • Attachment Size : ${sizeKB} KB (${sizeMB} MB)`)

    // Step 1: Send via Nodemailer SMTP
    const subject = `Your Vibrant Gujarat Memory • ${placeName}`
    console.log(`\n🚀 [SMTP DISPATCH] Sending email via ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}...`)
    console.log(`   • From   : ${process.env.MAIL_FROM}`)
    console.log(`   • To     : ${toEmail}`)
    console.log(`   • Subject: ${subject}`)

    const mailOptions = {
      from: process.env.MAIL_FROM,
      to: toEmail,
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

    console.log(`✅ [SMTP SUCCESS] Delivered to mail server!`)
    console.log(`   • Message ID : ${info.messageId}`)
    console.log(`   • Accepted   : ${JSON.stringify(info.accepted)}`)
    console.log(`   • Response   : ${info.response || '250 OK'}`)
    if (info.rejected && info.rejected.length > 0) {
      console.warn(`   • Rejected   : ${JSON.stringify(info.rejected)}`)
    }

    // Step 2: Save record in Supabase
    const dbResult = await saveEmailRecord(toEmail, placeName)

    const totalElapsed = Date.now() - startTime
    console.log(`\n🎉 [FLOW COMPLETED]`)
    console.log(`   • Status          : 200 OK`)
    console.log(`   • Recipient       : ${toEmail}`)
    console.log(`   • DB Stored       : ${dbResult?.success ? 'YES (Confirmed)' : 'NO (' + (dbResult?.error || dbResult?.reason) + ')'}`)
    console.log(`   • Total Time Taken: ${totalElapsed}ms`)
    console.log('═'.repeat(65) + '\n')

    return res.status(200).json({
      message: 'Photo sent successfully!',
      messageId: info.messageId,
      dbStatus: dbResult?.success ? 'saved' : 'skipped',
      dbRecord: dbResult?.record || null
    })
  } catch (error) {
    const totalElapsed = Date.now() - startTime
    console.error(`\n💥 [EMAIL DISPATCH FAILED] (${totalElapsed}ms)`)
    console.error(`   • Error Message : ${error.message}`)
    if (error.code) console.error(`   • Error Code    : ${error.code}`)
    if (error.response) console.error(`   • SMTP Response : ${error.response}`)
    console.error(`   • Stack Trace   :`, error.stack)
    console.log('═'.repeat(65) + '\n')
    return res.status(500).json({ message: 'Failed to send email. Check SMTP settings.' })
  }
})

app.listen(PORT, () => {
  console.log(`[server] Vibrant Gujarat AI Photo Booth running at http://localhost:${PORT}`)
})
