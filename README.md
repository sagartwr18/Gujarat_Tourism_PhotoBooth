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
