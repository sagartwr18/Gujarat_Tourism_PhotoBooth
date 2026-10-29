# Vibrant Gujarat • AI Photo Booth & Virtual Tourism Experience

A web-based AI Photo Booth celebrating the **Land of Legends – Gujarat**. Users can step in front of 12+ world-famous Gujarat landmarks, temples, and natural wonders using real-time browser-based AI selfie segmentation, face and demographic detection, countdown timer captures, and instant souvenir downloads or email delivery.

---

## 🏛️ Featured Gujarat Landmarks & Backdrops

1. **Statue of Unity, Kevadia** – World's tallest monument (182m) over the Narmada River
2. **White Rann of Kutch, Dhordo** – Moonlit expanse of the white salt desert & Rann Utsav
3. **Gir National Park, Sasan Gir** – Exclusive wildlife sanctuary of wild Asiatic Lions
4. **Somnath Jyotirlinga, Veraval** – First sacred Jyotirlinga on the roaring Arabian shore
5. **Dwarkadhish Temple, Devbhumi Dwarka** – Lord Krishna's ancient 2,500-year-old golden kingdom
6. **Rani ki Vav, Patan** – UNESCO World Heritage 11th-century subterranean stepwell
7. **Modhera Sun Temple, Mehsana** – Solanki golden age architectural masterpiece
8. **Laxmi Vilas Palace, Vadodara** – Royal Gaekwad palace four times the size of Buckingham Palace
9. **Sabarmati Atal Bridge, Ahmedabad** – Futuristic LED-lit riverfront bridge
10. **Champaner & Pavagadh, Panchmahal** – UNESCO World Heritage fortress & shrines
11. **Mandvi Beach & Coastline, Kutch** – Golden sands, windmills, and Arabian sea
12. **Mount Girnar Sacred Peaks, Junagadh** – Asia's longest ropeway & sacred misty summits

---

## ✨ Key Features & Next-Level Upgrades

- **Real-Time Virtual Backgrounds**: MediaPipe Selfie Segmentation runs client-side in real time to isolate the visitor and composite them cleanly onto Gujarat landmarks.
- **Vibrant Gujarat Theme & Luxury UI**: Deep obsidian blue with royal saffron (`#ea580c`), golden amber (`#f59e0b`), and peacock teal accents.
- **Interactive Destination Gallery**: Filter backdrops by *Heritage & Palaces*, *Spiritual & Temples*, *Nature & Wildlife*, and *Modern Gujarat*.
- **3-Second Countdown Timer & Shutter Flash**: 3-2-1 countdown overlay with smiling prompt and visual camera flash for authentic photo-booth feel.
- **Instant Souvenir Download**: Download full-resolution branded keepsakes directly (`.png`).
- **AI Keepsake Stamp**: Automatically overlays a luxury gold border and Gujarat Tourism emblem with the specific landmark name and date.
- **Smart Demographic Analysis**: On-device face detection estimates age, gender, and shares personalized cultural insights (*Kem Chho!*).
- **Email Sharing**: Send souvenir photos with custom HTML email template via Nodemailer and optionally record visits in Supabase.

---

## 🚀 Quick Start (Local Machine)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (`.env`)
Create a `.env` file in the root folder:
```env
# ----- SMTP (Email Delivery) -----
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_app_password
MAIL_FROM="Vibrant Gujarat Photo Booth <your_email@gmail.com>"

# ----- Supabase (Optional Email Tracking) -----
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

PORT=3001
```

### 3. Launch Frontend + Backend Concurrently
```bash
npm run dev:full
```
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001

---

## 🛠️ Tech Stack
- **Frontend**: React 19, Vite 7, HTML5 Canvas, MediaPipe Selfie Segmentation
- **AI Models**: `@vladmandic/face-api` (TinyFaceDetector, FaceLandmark68Tiny, AgeGenderNet)
- **Backend**: Node.js, Express 5, Nodemailer, Supabase JS

---

## 🚀 Deploy (Render + Vercel)

The app is deployed as two services: the **API on Render** and the **frontend on Vercel**.
Both must be configured, in this order.

### 1. Backend on Render

1. **New → Web Service**, connect this repository, branch `main`, root directory `.`
2. Runtime **Node**, build command `npm ci --omit=dev`, start command `node server.js`
3. Region: **Singapore** (lowest latency from India)
4. Health check path: `/api/health`
5. Environment variables:

   | Key | Value |
   |---|---|
   | `SMTP_HOST` | e.g. `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_SECURE` | `false` |
   | `SMTP_USER` | sending mailbox |
   | `SMTP_PASS` | app password (never the account password) |
   | `MAIL_FROM` | `"Vibrant Gujarat Photo Booth <mailbox>"` |
   | `SUPABASE_URL` | project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service-role key (server only) |
   | `ALLOWED_ORIGINS` | `https://<project>.vercel.app` (fill in after step 3) |
   | `NODE_VERSION` | `22` |

6. Verify `https://<service>.onrender.com/api/health` returns `{"status":"ok",...}`.

> Use the **Starter** plan for a live kiosk. Free instances sleep after ~15 minutes of
> inactivity and the first visitor waits 30–50 seconds.

### 2. Frontend on Vercel

1. **New Project**, import this repository (framework preset **Vite** is detected;
   `vercel.json` already sets build/output and the SPA rewrite).
2. Environment variable (Production): `VITE_API_URL=https://<service>.onrender.com`
   — no trailing slash.
3. Deploy and note the URL, e.g. `https://<project>.vercel.app`.

### 3. Close the CORS loop

Add the Vercel URL to `ALLOWED_ORIGINS` on Render and save. The service restarts
automatically. Localhost origins are always allowed for development.

### 4. Verify

- Open the Vercel URL → camera permission prompt → capture → email → download.
- Render logs show the per-step timings; the Supabase `emails` table gets a row.
- Kiosks need camera permission granted once for the new domain.

### Notes

- `.env` is git-ignored; set variables in each host's dashboard, never in the repo.
- SMTP ports 587/465 work on Render; port 25 is blocked.
- `ALLOWED_ORIGINS` plus the built-in rate limit (`RATE_LIMIT_MAX` per IP) keep the
  public email endpoint from being abused.
