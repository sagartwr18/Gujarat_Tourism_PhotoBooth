import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

const SELFIE_SEGMENTATION_SCRIPT = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js'

// API origin. Empty by default so local development keeps using the relative
// "/api" path (proxied to localhost:3001 by Vite). In production the frontend
// is hosted separately from the API, so VITE_API_URL points at the API host.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// How large the visitor's cut-out appears against the landmark (1.0 = 100% full frame).
const PERSON_ZOOM_VERTICAL = 1.0
const PERSON_ZOOM_HORIZONTAL = 1.0
const getPersonZoom = (vertical) => (vertical ? PERSON_ZOOM_VERTICAL : PERSON_ZOOM_HORIZONTAL)

// Detect mobile devices so we can adapt the AI model, camera constraints,
// and render loop accordingly. iPadOS 13+ reports itself as "MacIntel", so
// touch points are the only reliable way to tell it apart from a Mac.
const IS_IPAD =
  typeof navigator !== 'undefined' &&
  /Mac/.test(navigator.platform) &&
  navigator.maxTouchPoints > 1

const IS_MOBILE =
  IS_IPAD ||
  (typeof navigator !== 'undefined' &&
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))

// WebKit silently ignores ctx.filter on some Safari builds. Test it by writing
// and reading the property back instead of trusting the prototype.
const supportsCanvasFilter = () => {
  if (typeof document === 'undefined') return false
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return false
    ctx.filter = 'blur(1px)'
    return ctx.filter === 'blur(1px)'
  } catch {
    return false
  }
}
const CANVAS_FILTER_SUPPORTED = supportsCanvasFilter()

// Segmentation mask health checks.
//
// MediaPipe hands the mask back as a GPU-backed canvas/bitmap. Some WebKit
// builds lose its alpha channel (or return a solid bitmap), which turns
// `source-in` into a no-op and paints the whole camera frame over the landmark.
// Sampling a tiny copy tells us which channel actually carries the cut-out.
const MASK_SAMPLE_SIZE = 32
const MASK_MATTE_MAX = 320
const MASK_FG_LIMIT = 0.97

// Append ?debug=1 to the URL to print the camera mode and the person frame
// geometry on screen. Handy on a kiosk, where the browser console is not
// reachable. Hidden by default.
const DEBUG_CAMERA =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')

// Smaller on phones: 1080x1920 + per-frame segmentation is heavy on mobile GPUs
const getBoothSize = (vertical) => {
  if (vertical && IS_MOBILE) return { w: 720, h: 960 } // 3:4, matches the full front-camera view
  const long = IS_MOBILE ? 1280 : 1920
  const short = IS_MOBILE ? 720 : 1080
  return vertical ? { w: short, h: long } : { w: long, h: short }
}

// Phone portrait uses the browser default (facingMode only): on Android this
// returns the full front-sensor portrait view instead of a cropped 9:16 stream.
// Every other case keeps the existing request unchanged.
const buildVideoConstraints = (vertical, isMobile) => {
  if (vertical && isMobile) {
    return { facingMode: 'user' }
  }

  return {
    width: { ideal: vertical ? 720 : 1280 },
    height: { ideal: vertical ? 1280 : 720 },
    aspectRatio: undefined,
    facingMode: 'user'
  }
}

export const GUJARAT_DESTINATIONS = [
  {
    id: 'bhungas-rann-utsav',
    file: '1.webp',
    name: 'Bhungas at Rann Utsav',
    fullName: 'Bhungas at the Rann Utsav festival, Dhordo, Kutch',
    location: 'Dhordo, Kutch',
    category: 'Heritage & Culture',
    tag: 'Traditional Mud Architecture',
    badge: 'Rann Utsav Festival',
    description: 'Traditional circular mud huts adorned with authentic mirror work and lipan art in the white desert.',
    accent: '#ea580c'
  },
  {
    id: 'sabha-mandap-modhera',
    file: '2.webp',
    name: 'Sabha Mandap, Sun Temple',
    fullName: 'Sabha Mandap, Modhera Sun Temple',
    location: 'Modhera, Mehsana',
    category: 'Heritage & Architecture',
    tag: 'Solanki Golden Age',
    badge: 'Solar Assembly Hall',
    description: 'Magnificent assembly hall with 52 intricately carved pillars depicting the Ramayana & Mahabharata.',
    accent: '#ca8a04'
  },
  {
    id: 'great-rann-of-kutch',
    file: '3.webp',
    name: 'Great Rann of Kutch',
    fullName: 'Great Rann of Kutch, Dhordo',
    location: 'Dhordo, Kutch',
    category: 'Nature & Landscapes',
    tag: 'World Largest Salt Desert',
    badge: 'White Desert Wonder',
    description: 'Breathtaking endless expanse of pure white salt desert shimmering under the open Gujarat sky.',
    accent: '#0284c7'
  },
  {
    id: 'jami-masjid-champaner',
    file: '4.webp',
    name: 'Jami Masjid, Champaner',
    fullName: 'Jami Masjid, Champaner-Pavagadh',
    location: 'Champaner, Panchmahal',
    category: 'Heritage & Architecture',
    tag: 'UNESCO World Heritage',
    badge: 'Indo-Islamic Masterpiece',
    description: 'Spectacular 16th-century mosque with soaring minarets and 172 stone carved pillars.',
    accent: '#059669'
  },
  {
    id: 'greater-flamingos-thol',
    file: '5.webp',
    name: 'Greater Flamingos, Thol Sanctuary',
    fullName: 'Greater flamingos, Thol Bird Sanctuary',
    location: 'Thol Lake, Mehsana',
    category: 'Nature & Landscapes',
    tag: 'Ramsar Wetland Sanctuary',
    badge: 'Flamingo Paradise',
    description: 'Serene freshwater wetland sanctuary flocked by thousands of vibrant pink greater flamingos.',
    accent: '#f43f5e'
  },
  {
    id: 'hathiisingh-jain-temple',
    file: '6.webp',
    name: 'Hathiisingh Jain Temple',
    fullName: 'Hathiisingh Jain Temple, Ahmedabad',
    location: 'Ahmedabad',
    category: 'Spiritual & Temples',
    tag: 'White Marble Carvings',
    badge: '1848 Heritage Marvel',
    description: 'Exquisite two-story white marble temple with 52 shrines dedicated to Dharmanatha.',
    accent: '#eab308'
  },
  {
    id: 'laxmi-vilas-palace',
    file: '9.webp',
    name: 'Laxmi Vilas Palace',
    fullName: 'Laxmi Vilas Palace, Vadodara',
    location: 'Vadodara',
    category: 'Heritage & Architecture',
    tag: 'Royal Gaekwad Estate',
    badge: 'Indo-Saracenic Wonder',
    description: 'Monumental royal residence four times the size of Buckingham Palace set in 500-acre grounds.',
    accent: '#9333ea'
  },
  {
    id: 'bahauddin-maqbara',
    file: '10.webp',
    name: 'Bahauddin Vazir Maqbara',
    fullName: 'Bahauddin Vazir Maqbara, Junagadh',
    location: 'Junagadh',
    category: 'Heritage & Architecture',
    tag: 'Gothic & Indo-Islamic',
    badge: 'Iconic Spiral Minarets',
    description: 'Mesmerizing mausoleum complex famous for its spiral staircases wrapping around four grand minarets.',
    accent: '#d97706'
  },
  {
    id: 'surya-kund-modhera',
    file: '11.webp',
    name: 'Surya Kund, Sun Temple',
    fullName: 'Surya Kund at Sun Temple, Modhera',
    location: 'Modhera, Mehsana',
    category: 'Heritage & Architecture',
    tag: 'Geometric Stepped Reservoir',
    badge: '108 Miniature Shrines',
    description: 'Architectural marvel of stepped water reservoir adorned with 108 intricately sculpted miniature temples.',
    accent: '#ca8a04'
  },
  {
    id: 'shiva-shakti-temple-polo',
    file: '12.webp',
    name: 'Shiva Shakti Temple, Polo Forest',
    fullName: 'Shiva Shakti Temple, Polo Forest Abhapur',
    location: 'Polo Forest, Sabarkantha',
    category: 'Nature & Landscapes',
    tag: 'Ancient Forest Sanctuary',
    badge: '15th-Century Ruins',
    description: 'Mystical sandstone temple ruins hidden deep within the lush green canopy of the Polo Forest.',
    accent: '#16a34a'
  },
  {
    id: 'rani-ki-vav',
    file: '13.webp',
    name: 'Rani ki Vav Stepwell',
    fullName: 'Rani ki Vav, Patan',
    location: 'Patan',
    category: 'Heritage & Architecture',
    tag: 'UNESCO World Heritage',
    badge: 'Subterranean Masterpiece',
    description: 'Inverted underground temple stepwell built in the 11th century with over 500 mythological stone sculptures.',
    accent: '#b45309'
  },
  {
    id: 'statue-of-unity',
    file: '14.webp',
    name: 'Statue of Unity',
    fullName: 'Statue of Unity, Kevadia',
    location: 'Kevadia, Narmada',
    category: 'Monuments & History',
    tag: "World's Tallest Monument (182m)",
    badge: 'Pride of Kevadia',
    description: 'Towering 182-meter colossal statue honoring Sardar Vallabhbhai Patel above the scenic Narmada waters.',
    accent: '#ea580c'
  },
  {
    id: 'kirti-toran-vadnagar',
    file: '15.webp',
    name: 'Kirti Toran, Vadnagar',
    fullName: 'Kirti Toran, Vadnagar',
    location: 'Vadnagar, Mehsana',
    category: 'Heritage & Architecture',
    tag: '12th-Century Solanki Gateway',
    badge: 'Gateway of Glory',
    description: '40-foot-high ornate red and yellow sandstone victory arch standing as an eternal symbol of Solanki glory.',
    accent: '#f59e0b'
  },
  {
    id: 'hridaya-kunj-sabarmati',
    file: '16.webp',
    name: 'Hridaya Kunj, Sabarmati Ashram',
    fullName: 'Hridaya Kunj, Sabarmati Ashram, Ahmedabad',
    location: 'Sabarmati, Ahmedabad',
    category: 'Monuments & History',
    tag: "Mahatma Gandhi's Residence",
    badge: 'Heart of Non-Violence',
    description: 'The historic cottage residence of Mahatma Gandhi and Kasturba where the Indian freedom movement took flight.',
    accent: '#0d9488'
  },
  {
    id: 'swaminarayan-mandir-kalupur',
    file: '17.webp',
    name: 'Shri Swaminarayan Mandir, Kalupur',
    fullName: 'Shri Swaminarayan Mandir, Kalupur, Ahmedabad',
    location: 'Kalupur, Ahmedabad',
    category: 'Spiritual & Temples',
    tag: 'First Swaminarayan Temple (1822)',
    badge: 'Exquisite Teakwood Carvings',
    description: 'First shrine of the Swaminarayan Sampraday featuring vibrant painted Burmese teakwood domes and gateways.',
    accent: '#d97706'
  }
]

export const getDestinationImagePath = (dest, isVertical) => {
  if (!dest) return ''
  const folder = isVertical ? 'Vertical HD' : 'Horizontal HD'
  return `/destinations/${encodeURIComponent(folder)}/${dest.file}`
}

// Small WebP copies used only by the picker grid. The booth keeps using the
// full-size HD files above for the canvas and the CSS background layer.
export const getDestinationThumbPath = (dest, isVertical) => {
  if (!dest) return ''
  const folder = isVertical ? 'Vertical' : 'Horizontal'
  return `/destinations/Thumbs/${folder}/${dest.file}`
}

// Landing page slides use the enhanced hero images in their own folder.
const getLandingImagePath = (file) =>
  `/destinations/${encodeURIComponent('Landing Page')}/${file}`

const drawMirroredCover = (ctx, source, offsetX, offsetY, renderW, renderH, canvasW) => {
  ctx.save()
  ctx.translate(canvasW, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(source, offsetX, offsetY, renderW, renderH)
  ctx.restore()
}

// "Cover" fit of the camera frame onto the target canvas: the source is scaled
// until it covers the canvas, so only the overflowing axis is cropped. A wider
// source (e.g. 4:3 or 16:9) therefore never loses the top/bottom of the frame
// on a 9:16 canvas — only the sides.
const computeCoverRect = (vWidth, vHeight, targetWidth, targetHeight) => {
  const videoAspect = vWidth / vHeight
  const canvasAspect = targetWidth / targetHeight

  if (videoAspect > canvasAspect) {
    // Source is wider than the canvas -> match height, crop the sides.
    const renderH = targetHeight
    const renderW = targetHeight * videoAspect
    return { renderW, renderH, offsetX: (targetWidth - renderW) / 2, offsetY: 0 }
  }

  // Source is taller than the canvas -> match width, crop the top/bottom.
  const renderW = targetWidth
  const renderH = targetWidth / videoAspect
  return { renderW, renderH, offsetX: 0, offsetY: (targetHeight - renderH) / 2 }
}

/* ========================================= */
/* LANDING PAGE — VIBRANT POSTER             */
/* ========================================= */

// 5 enhanced hero slides from the Landing Page folder.
const LANDING_SLIDES = ['11.webp', '14.webp', '3.webp', '5.webp', '9.webp']

const LandingLogo = () => (
  <img
    src="/assets/gujarat-tourism-logo.png"
    alt="Gujarat Tourism"
    className="landing-theme-logo"
  />
)

/* ---------- Landing hero — Vibrant Poster ---------- */
function PosterLanding({ destinations, currentSlide, onSelect, onStart }) {
  const current = destinations[currentSlide]
  const secondary = [1, 2].map(
    (offset) => destinations[(currentSlide + offset) % destinations.length]
  )

  return (
    <div className="poster-shell">
      <div className="poster-blob poster-blob-saffron" aria-hidden="true" />
      <div className="poster-blob poster-blob-teal" aria-hidden="true" />

      <header className="poster-navbar">
        <LandingLogo />
        {/* Google Translate is moved into this slot by index.html so the
            language picker sits inside the navbar and scrolls with the page. */}
        <div id="landing-translate-slot" className="poster-navbar-translate" />
      </header>

      <main className="poster-main">
        <section className="poster-copy">
          <span className="poster-eyebrow">Explore the vibrant spirit of Gujarat.</span>
          <h1 className="poster-title">
            Welcome to the <span>Land of Legends</span> – Gujarat
          </h1>
          <p className="poster-description">
            Embark on a journey through vibrant cultures, majestic heritage, and breathtaking
            landscapes. From the timeless white sands of the Rann of Kutch to the sacred shores
            of Somnath and the wilderness of Gir, discover a land where history, spirituality,
            and adventure come alive.
          </p>
          <div className="poster-actions">
            <button className="poster-cta" onClick={onStart}>
              Start Your Journey <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>

        <section className="poster-collage" aria-label="Featured destinations">
          <button
            className="poster-card poster-card-main"
            type="button"
            onClick={() => onSelect(currentSlide)}
          >
            <span
              className="poster-card-image"
              style={{ backgroundImage: `url(${getLandingImagePath(current.file)})` }}
            />
            <span className="poster-card-shade" />
            <span className="poster-card-info">
              <strong>{current.name}</strong>
              <em>{current.location}</em>
            </span>
          </button>

          {secondary.map((dest, index) => (
            <button
              key={dest.id}
              className={`poster-card poster-card-small poster-card-${index + 1}`}
              type="button"
              onClick={() => onSelect(destinations.indexOf(dest))}
            >
              <span
                className="poster-card-image"
                style={{ backgroundImage: `url(${getLandingImagePath(dest.file)})` }}
              />
              <span className="poster-card-shade" />
              <span className="poster-card-info">
                <strong>{dest.name}</strong>
                <em>{dest.location}</em>
              </span>
            </button>
          ))}
        </section>
      </main>
    </div>
  )
}

function LandingPage({ onStart, isVertical }) {
  const [currentSlide, setCurrentSlide] = useState(0)

  const heroDestinations = LANDING_SLIDES.map((file) =>
    GUJARAT_DESTINATIONS.find((d) => d.file === file)
  )

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroDestinations.length)
    }, 4500)
    return () => clearInterval(timer)
  }, [heroDestinations.length])

  // Warm the cache so the rotating hero card never flashes an empty card.
  useEffect(() => {
    LANDING_SLIDES.forEach((file) => {
      const img = new Image()
      img.src = getLandingImagePath(file)
    })
  }, [])

  return (
    <div className={`landing-page landing-theme-poster ${isVertical ? 'orientation-vertical' : 'orientation-horizontal'}`}>
      <PosterLanding
        destinations={heroDestinations}
        currentSlide={currentSlide}
        onSelect={setCurrentSlide}
        onStart={onStart}
      />

      {/* Bottom Footer */}
      <footer className="landing-footer footer-poster">
        <div className="footer-social-links">
          {/* Facebook */}
          <a
            href="https://www.facebook.com/gujtourism"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Facebook"
            className="footer-social-icon"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
          </a>
          {/* X / Twitter */}
          <a
            href="https://twitter.com/GujaratTourism"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X (Twitter)"
            className="footer-social-icon"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
          {/* LinkedIn */}
          <a
            href="https://www.linkedin.com/company/gujarat-tourism/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn"
            className="footer-social-icon"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
            </svg>
          </a>
          {/* Instagram */}
          <a
            href="https://www.instagram.com/gujarattourism/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Instagram"
            className="footer-social-icon"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
            </svg>
          </a>
          {/* YouTube */}
          <a
            href="https://www.youtube.com/user/gujarattourism"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="YouTube"
            className="footer-social-icon"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          </a>
          {/* Pinterest */}
          <a
            href="https://www.pinterest.com/gujarattourism/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Pinterest"
            className="footer-social-icon"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345-.09.375-.291 1.199-.332 1.357-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z"/>
            </svg>
          </a>
        </div>

        <div className="footer-legal-links">
          <a href="#terms" onClick={(e) => e.preventDefault()}>Terms</a>
          <a href="#policy" onClick={(e) => e.preventDefault()}>Policy</a>
          <a href="#disclaimer" onClick={(e) => e.preventDefault()}>Disclaimer</a>
        </div>
      </footer>
    </div>
  )
}

function InstructionsPage({ onBack, onProceed, isVertical }) {
  return (
    <div className={`instructions-clean-page page-transition ${isVertical ? 'orientation-vertical' : 'orientation-horizontal'}`}>
      {/* Top Navbar mirroring the landing page pill */}
      <nav className="instructions-navbar">
        <LandingLogo />

        <button className="selector-back-button" onClick={onBack} title="Go Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Back</span>
        </button>
      </nav>

      {/* Main Instructions Card Container */}
      <main className="instructions-content-wrap">
        <div className="instructions-clean-card">
          <div className="instructions-clean-header">
            <h1 className="instructions-clean-title">
              How It <span>Works</span>
            </h1>
            <p className="instructions-clean-subtitle">
              Create your personalized Gujarat keepsake in 4 simple steps
            </p>
          </div>

          <div className="instructions-clean-body">
            {/* Left: 4 Numbered Steps */}
            <div className="instructions-clean-steps">
              <div className="instructions-clean-step">
                <div className="step-badge">1</div>
                <div className="step-text-wrap">
                  <h4 className="step-heading">Choose a Landmark</h4>
                  <p className="step-info">Select from iconic Gujarat heritage and spiritual destinations</p>
                </div>
              </div>

              <div className="instructions-clean-step">
                <div className="step-badge">2</div>
                <div className="step-text-wrap">
                  <h4 className="step-heading">Enable Camera</h4>
                  <p className="step-info">Allow camera permissions for real-time virtual backdrop segmentation</p>
                </div>
              </div>

              <div className="instructions-clean-step">
                <div className="step-badge">3</div>
                <div className="step-text-wrap">
                  <h4 className="step-heading">Pose & Snap</h4>
                  <p className="step-info">Position yourself in frame and capture using the 3s timer or instant snap</p>
                </div>
              </div>

              <div className="instructions-clean-step">
                <div className="step-badge">4</div>
                <div className="step-text-wrap">
                  <h4 className="step-heading">Receive & Share</h4>
                  <p className="step-info">Download your framed HD photo or send directly to your email</p>
                </div>
              </div>
            </div>

            {/* Right: Camera Circle + Start Now Button */}
            <div className="instructions-clean-action">
              <div className="camera-blue-circle">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
              </div>
              <button className="clean-start-now-btn" onClick={onProceed}>
                <span>Start Now</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function BackgroundSelector({ onSelect, onBack, initialSelectedId, isVertical }) {
  const [selectedDest, setSelectedDest] = useState(
    initialSelectedId ? GUJARAT_DESTINATIONS.find((d) => d.id === initialSelectedId) || null : null
  )

  const handleCardClick = (dest) => {
    setSelectedDest(dest)
    onSelect(dest)
  }

  return (
    <div className={`background-selector ${isVertical ? 'selector-vertical-mode' : 'selector-horizontal-mode'}`}>
      <nav className="selector-navbar">
        <LandingLogo />
        <button className="selector-back-button" onClick={onBack} title="Go Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Back</span>
        </button>
      </nav>

      <header className="selector-header-bar">
        <h2 className="selector-title">
          Choose Your <span>Background</span>
        </h2>
      </header>

      <div className={`background-grid ${isVertical ? 'grid-vertical' : 'grid-horizontal'}`}>
        {GUJARAT_DESTINATIONS.map((dest) => {
          const isSelected = selectedDest?.id === dest.id
          const imageSrc = getDestinationThumbPath(dest, isVertical)

          return (
            <div
              key={dest.id}
              className={`background-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handleCardClick(dest)}
            >
              <div className="card-image-wrap">
                <img
                  src={imageSrc}
                  alt={dest.name}
                  loading="eager"
                  decoding="async"
                  width={420}
                  height={isVertical ? 747 : 236}
                  onError={(e) => {
                    // Safari occasionally drops a single image request; retry
                    // once with a cache-buster instead of leaving a blank card.
                    const el = e.currentTarget
                    if (el.dataset.retried) return
                    el.dataset.retried = '1'
                    el.src = `${imageSrc}?r=1`
                  }}
                />
                {isSelected && (
                  <div className="selected-check">
                    <span>✓ Selected</span>
                  </div>
                )}
              </div>
              <div className="card-info">
                <div className="card-loc">
                  {/* <span className="loc-pin">📍</span> */}
                  <span>{dest.location}</span>
                </div>
                <h3>{dest.name}</h3>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function App() {
  const videoRef = useRef(null)
  const compositeCanvasRef = useRef(null)
  const personCanvasRef = useRef(null)
  const segmentationModelRef = useRef(null)
  const segmentationReadyRef = useRef(false)
  const segmentationBusyRef = useRef(false)
  const segmentationMaskRef = useRef(null)
  const renderFrameRef = useRef(null)
  const captureCanvasRef = useRef(null)
  const startingRef = useRef(false)
  const cameraRequestIdRef = useRef(0)
  const isCameraOpenRef = useRef(false)
  const backgroundImageRef = useRef(null)
  const maskSampleRef = useRef(null)
  const maskMatteRef = useRef(null)
  const maskDebugRef = useRef({ mode: null, at: 0 })
  const countdownIntervalRef = useRef(null)
  const countdownTimeoutRef = useRef(null)

  // Orientation State: 'vertical' (1080x1920) or 'horizontal' (1920x1080)
  const [orientation, setOrientation] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < window.innerHeight ? 'vertical' : 'horizontal'
    }
    return 'horizontal'
  })
  const isVertical = orientation === 'vertical'
  const isVerticalRef = useRef(isVertical)
  isVerticalRef.current = isVertical

  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [showLanding, setShowLanding] = useState(true)
  const [showInstructions, setShowInstructions] = useState(false)
  const [showBackgroundSelector, setShowBackgroundSelector] = useState(false)
  const [selectorSource, setSelectorSource] = useState('instructions')
  const [selectedDestination, setSelectedDestination] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSegmentationReady, setIsSegmentationReady] = useState(false)
  const [segmentationError, setSegmentationError] = useState(null)
  const [error, setError] = useState(null)
  const [capturedImage, setCapturedImage] = useState(null)
  const [email, setEmail] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailStatusType, setEmailStatusType] = useState('idle')
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [debugCamera, setDebugCamera] = useState(null)
  const [debugMask, setDebugMask] = useState(null)

  // Countdown timer state
  const [countdown, setCountdown] = useState(null)
  const [isCountingDown, setIsCountingDown] = useState(false)
  const [isFlashActive, setIsFlashActive] = useState(false)

  // Detect and listen to screen orientation changes smoothly
  useEffect(() => {
    const handleResize = () => {
      const isPortraitScreen = window.innerWidth < window.innerHeight
      // If user hasn't explicitly locked, auto-adjust to screen geometry
      setOrientation(isPortraitScreen ? 'vertical' : 'horizontal')
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])

  useEffect(() => {
    personCanvasRef.current = document.createElement('canvas')
  }, [])

  // Which channel carries the cut-out, and how much of the frame it covers.
  // Returns null when the mask cannot be sampled (released/tainted bitmap).
  const analyzeSegmentationMask = (mask) => {
    const width = mask?.width || 0
    const height = mask?.height || 0
    if (!width || !height) return null

    let sample = maskSampleRef.current
    if (!sample) {
      const canvas = document.createElement('canvas')
      canvas.width = MASK_SAMPLE_SIZE
      canvas.height = MASK_SAMPLE_SIZE
      sample = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) }
      maskSampleRef.current = sample
    }

    let pixels
    try {
      sample.ctx.clearRect(0, 0, MASK_SAMPLE_SIZE, MASK_SAMPLE_SIZE)
      sample.ctx.drawImage(mask, 0, 0, MASK_SAMPLE_SIZE, MASK_SAMPLE_SIZE)
      pixels = sample.ctx.getImageData(0, 0, MASK_SAMPLE_SIZE, MASK_SAMPLE_SIZE).data
    } catch {
      // Tainted or already-released bitmap: keep the last good mask.
      return null
    }

    let alphaMin = 255
    let alphaMax = 0
    let lumMin = 255
    let lumMax = 0
    let alphaFg = 0
    let lumFg = 0

    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3]
      const lum = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000

      if (alpha < alphaMin) alphaMin = alpha
      if (alpha > alphaMax) alphaMax = alpha
      if (lum < lumMin) lumMin = lum
      if (lum > lumMax) lumMax = lum
      if (alpha >= 128) alphaFg += 1
      if (lum >= 128) lumFg += 1
    }

    const count = pixels.length / 4
    const alphaContrast = alphaMax - alphaMin
    const lumContrast = lumMax - lumMin
    let mode
    let fg

    if (alphaContrast > 8) {
      // Healthy mask: the cut-out is already in the alpha channel.
      mode = 'alpha'
      fg = alphaFg / count
    } else if (alphaMax < 24) {
      // A fully transparent mask is normally an empty frame. Only rebuild from
      // luminance when the contrast is strong enough to be a real subject.
      mode = lumContrast >= 160 ? 'lum' : 'empty'
      fg = mode === 'lum' ? lumFg / count : 0
    } else {
      // Opaque mask with no alpha contrast: exactly what a lost alpha channel
      // looks like. Rebuild from luminance when the matte is still in there.
      mode = lumContrast >= 32 ? 'lum' : 'opaque'
      fg = mode === 'lum' ? lumFg / count : 1
    }

    return {
      mode,
      fg,
      width,
      height,
      alpha: `${alphaMin}-${alphaMax}`,
      lum: `${Math.round(lumMin)}-${Math.round(lumMax)}`
    }
  }

  // Rebuild a real alpha matte from a mask that only carries luminance. The
  // matte has the booth aspect, so it maps 1:1 onto the person rect, and it is
  // only a few hundred pixels wide — the cut-out is soft, not blocky.
  const buildLuminanceMatte = (mask, targetWidth, targetHeight) => {
    const scale = MASK_MATTE_MAX / Math.max(targetWidth, targetHeight)
    const w = Math.max(1, Math.round(targetWidth * scale))
    const h = Math.max(1, Math.round(targetHeight * scale))

    let matte = maskMatteRef.current
    if (!matte) {
      matte = document.createElement('canvas')
      maskMatteRef.current = matte
    }
    if (matte.width !== w || matte.height !== h) {
      matte.width = w
      matte.height = h
    }

    const ctx = matte.getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, w, h)
    // Stretch, not cover-crop: the camera frame is stretched onto the person
    // rect below, so the matte has to follow the exact same mapping.
    ctx.drawImage(mask, 0, 0, w, h)

    let image
    try {
      image = ctx.getImageData(0, 0, w, h)
    } catch {
      return null
    }

    const data = image.data
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = lum
    }
    ctx.putImageData(image, 0, 0)
    return matte
  }

  // The debug badge must not re-render 20 times a second.
  const reportMaskDebug = (stats) => {
    const now = performance.now()
    const mode = stats?.mode || 'none'
    const last = maskDebugRef.current
    if (mode === last.mode && now - last.at < 1000) return
    maskDebugRef.current = { mode, at: now }
    setDebugMask(stats)
  }

  // Clean up countdown timers if the component unmounts mid-countdown
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      if (countdownTimeoutRef.current) clearTimeout(countdownTimeoutRef.current)
    }
  }, [])

  // Load MediaPipe Selfie Segmentation Script
  useEffect(() => {
    let mounted = true
    setIsLoading(true)
    setSegmentationError(null)

    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`)
        if (existing) {
          if (window.SelfieSegmentation) {
            resolve()
            return
          }
          existing.addEventListener('load', resolve, { once: true })
          existing.addEventListener('error', reject, { once: true })
          return
        }

        const script = document.createElement('script')
        script.src = src
        script.async = true
        script.onload = resolve
        script.onerror = reject
        document.body.appendChild(script)
      })

    const loadSegmentationModel = async () => {
      try {
        await loadScript(SELFIE_SEGMENTATION_SCRIPT)
        if (!mounted || !window.SelfieSegmentation) return

        const model = new window.SelfieSegmentation({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
        })

        model.setOptions({
          // 0 = General / mobile model (256×256, works well on phones in portrait)
          // 1 = Landscape model (144×256, optimised for desktop widescreen)
          modelSelection: IS_MOBILE ? 0 : 1
        })

        model.onResults((results) => {
          if (!mounted) return
          segmentationBusyRef.current = false

          const mask = results.segmentationMask
          const stats = analyzeSegmentationMask(mask)
          if (DEBUG_CAMERA) reportMaskDebug(stats)

          if (!stats) {
            // Unsampleable bitmap: keep the last good mask rather than dropping
            // the cut-out for a frame.
            return
          }

          if (stats.fg > MASK_FG_LIMIT) {
            // The mask claims the whole frame is a person. That is what a
            // broken WebKit mask looks like, and drawing it would hide the
            // landmark. Refuse it and stay in "Preparing AI…".
            segmentationMaskRef.current = null
            setIsSegmentationReady(false)
            return
          }

          if (stats.mode === 'alpha') {
            segmentationMaskRef.current = mask
            setIsSegmentationReady(true)
            return
          }

          if (stats.mode === 'lum') {
            const { w, h } = getBoothSize(isVerticalRef.current)
            const matte = buildLuminanceMatte(mask, w, h)
            if (matte) {
              segmentationMaskRef.current = matte
              setIsSegmentationReady(true)
              return
            }
          }

          if (stats.mode === 'empty') {
            // Camera is running but nobody is in shot.
            segmentationMaskRef.current = null
            setIsSegmentationReady(true)
            return
          }

          // Opaque/degenerate mask. Never paint the raw camera over the landmark.
          segmentationMaskRef.current = null
          setIsSegmentationReady(false)
        })

        // Fetch and compile the wasm/model up front. send() rejects until the
        // graph is initialised, which is what left Safari with no cut-out at
        // all while the canvas quietly fell back to the raw camera.
        if (typeof model.initialize === 'function') {
          await model.initialize()
        }

        if (!mounted) {
          try {
            model.close()
          } catch {
            // Graph was already torn down.
          }
          return
        }

        segmentationModelRef.current = model
        segmentationReadyRef.current = true
        setIsLoading(false)
      } catch (err) {
        console.error('Error loading segmentation model:', err)
        if (!mounted) return
        segmentationReadyRef.current = false
        setIsSegmentationReady(false)
        setIsLoading(false)
        setSegmentationError(
          'AI background removal could not start on this browser. Please reload the page, or try again in Chrome or Safari.'
        )
      }
    }

    loadSegmentationModel()

    return () => {
      mounted = false
      segmentationReadyRef.current = false
      segmentationBusyRef.current = false
      segmentationMaskRef.current = null
      try {
        segmentationModelRef.current?.close?.()
      } catch {
        // Graph was already torn down.
      }
      segmentationModelRef.current = null
    }
  }, [])

  // Preload Selected Destination Background Image (matches the booth orientation)
  useEffect(() => {
    if (!selectedDestination) {
      backgroundImageRef.current = null
      return
    }

    const src = getDestinationImagePath(selectedDestination, isVertical)
    let cancelled = false
    let retryTimeout = null
    let attempt = 0

    const load = () => {
      if (cancelled) return

      attempt += 1
      const img = new Image()
      let applied = false

      const apply = async () => {
        if (applied || cancelled) return
        applied = true
        try {
          // Safari only guarantees the bitmap is drawable once decode() settles.
          if (typeof img.decode === 'function') await img.decode()
        } catch {
          // decode() can reject on WebKit even when the bitmap is usable;
          // naturalWidth below is the real test.
        }
        if (!cancelled && img.naturalWidth) {
          backgroundImageRef.current = img
        }
      }

      img.onload = apply
      img.onerror = () => {
        applied = true
        if (cancelled) return
        if (attempt < 3) {
          // A dropped request is the usual Safari failure; retry briefly.
          retryTimeout = setTimeout(load, 500)
        } else {
          backgroundImageRef.current = null
          console.warn('[booth] Could not load background image:', src)
        }
      }

      // Cache-bust retries so the failed entry isn't reused.
      img.src = attempt === 1 ? src : `${src}?retry=${attempt}`
      if (img.complete && img.naturalWidth) apply()
    }

    load()

    return () => {
      cancelled = true
      if (retryTimeout) clearTimeout(retryTimeout)
    }
  }, [selectedDestination, isVertical])

  // Draw Composited Canvas Frame (16:9 landscape, 3:4 phone portrait, 9:16 other portrait)
  const drawCompositedFrame = (video) => {
    if (!compositeCanvasRef.current || !personCanvasRef.current || !video) return

    const compositeCanvas = compositeCanvasRef.current
    const personCanvas = personCanvasRef.current
    const selectedBgImage = backgroundImageRef.current

    // Standard 16:9 for landscape/desktop, 3:4 on phones in portrait
    const { w: targetWidth, h: targetHeight } = getBoothSize(isVerticalRef.current)

    if (compositeCanvas.width !== targetWidth || compositeCanvas.height !== targetHeight) {
      compositeCanvas.width = targetWidth
      compositeCanvas.height = targetHeight
    }
    if (personCanvas.width !== targetWidth || personCanvas.height !== targetHeight) {
      personCanvas.width = targetWidth
      personCanvas.height = targetHeight
    }

    const compositeCtx = compositeCanvas.getContext('2d')
    const personCtx = personCanvas.getContext('2d')

    compositeCtx.imageSmoothingEnabled = true
    compositeCtx.imageSmoothingQuality = 'high'
    personCtx.imageSmoothingEnabled = true
    personCtx.imageSmoothingQuality = 'high'

    compositeCtx.clearRect(0, 0, targetWidth, targetHeight)

    // 1. Draw Landmark Background (top-anchored cover crop, never stretched)
    if (selectedBgImage && selectedBgImage.complete && selectedBgImage.naturalWidth !== 0) {
      const c = computeCoverRect(
        selectedBgImage.naturalWidth,
        selectedBgImage.naturalHeight,
        targetWidth,
        targetHeight
      )
      compositeCtx.drawImage(selectedBgImage, c.offsetX, 0, c.renderW, c.renderH)
    }
    // If the bitmap is not ready yet, leave the canvas transparent so the
    // .background-overlay layer (z-index 1) shows the landmark instead. An
    // opaque fill here would cover it and leave a black preview on slow links.

    const vW = video.videoWidth || targetWidth
    const vH = video.videoHeight || targetHeight

    // 2. Compute Cover Scaling & Centering for Webcam Video onto the booth canvas at 100% zoom
    const { renderW, renderH } = computeCoverRect(vW, vH, targetWidth, targetHeight)
    const personW = renderW * getPersonZoom(isVerticalRef.current)
    const personH = renderH * getPersonZoom(isVerticalRef.current)
    const personX = (targetWidth - personW) / 2
    const personY = personH > targetHeight
      ? (targetHeight - personH) * 0.15   // overflow: bias toward the top so faces aren't cut off
      : targetHeight - personH

    const mask = segmentationMaskRef.current

    // 3. Cutout and composite the user onto the landmark (mirrored like a selfie mirror)
    if (mask) {
      try {
        personCtx.clearRect(0, 0, targetWidth, targetHeight)
        if (CANVAS_FILTER_SUPPORTED) personCtx.filter = 'blur(1px)'
        drawMirroredCover(personCtx, mask, personX, personY, personW, personH, targetWidth)
        if (CANVAS_FILTER_SUPPORTED) personCtx.filter = 'none'
        personCtx.globalCompositeOperation = 'source-in'
        drawMirroredCover(personCtx, video, personX, personY, personW, personH, targetWidth)
        personCtx.globalCompositeOperation = 'source-over'
        compositeCtx.drawImage(personCanvas, 0, 0, targetWidth, targetHeight)
      } catch (err) {
        // A mask that WebKit already released must not leave a half-painted
        // frame. Clearing the person layer keeps the landmark visible.
        personCtx.globalCompositeOperation = 'source-over'
        personCtx.filter = 'none'
        personCtx.clearRect(0, 0, targetWidth, targetHeight)
        console.warn('[booth] Skipped a bad segmentation frame:', err?.message || err)
      }
    } else {
      // No usable mask yet (the AI is still warming up, or it returned a
      // degenerate one). Keep the landmark visible: never paint the raw camera.
    }
  }

  // Animation Frame Loop
  //
  // On mobile we throttle segmentation inference to ~20 FPS to avoid
  // overwhelming the mobile GPU / WebGL context, which causes mask drops.
  const lastSegTimeRef = useRef(0)
  const SEG_INTERVAL_MS = IS_MOBILE ? 50 : 0 // 50 ms ≈ 20 FPS on mobile

  const runFrameLoop = () => {
    try {
      const video = videoRef.current
      if (!video || !isCameraOpenRef.current) return

      if (!video.videoWidth || !video.videoHeight) return

      drawCompositedFrame(video)

      const now = performance.now()
      const canSend =
        segmentationReadyRef.current &&
        segmentationModelRef.current &&
        !segmentationBusyRef.current &&
        now - lastSegTimeRef.current >= SEG_INTERVAL_MS

      if (canSend) {
        segmentationBusyRef.current = true
        lastSegTimeRef.current = now
        segmentationModelRef.current
          .send({ image: video })
          .catch((err) => {
            console.error('Segmentation frame failed:', err)
            segmentationBusyRef.current = false
            // Keep the last good mask on every platform so one dropped frame
            // never flashes the landmark away.
          })
      }
    } catch (err) {
      // A single bad frame must never kill the preview for good.
      console.warn('[booth] Frame loop error:', err?.message || err)
    } finally {
      // Always re-arm while the booth is open, including after an error.
      if (isCameraOpenRef.current && videoRef.current) {
        renderFrameRef.current = requestAnimationFrame(runFrameLoop)
      } else {
        renderFrameRef.current = null
      }
    }
  }

  const startCamera = async () => {
    // The auto-start effect, Retake, and the orientation effect can all ask for
    // a camera at once. Without this guard each call opens a second
    // getUserMedia stream that is never stopped.
    if (startingRef.current) return
    startingRef.current = true
    const requestId = ++cameraRequestIdRef.current

    try {
      setError(null)

      // Tear down any previous stream and loop before opening a new one.
      if (renderFrameRef.current) {
        cancelAnimationFrame(renderFrameRef.current)
        renderFrameRef.current = null
      }
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop())
        videoRef.current.srcObject = null
      }

      // Build the video constraints for the current orientation and device
      const constraints = {
        video: buildVideoConstraints(isVerticalRef.current, IS_MOBILE)
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      // The visitor may have navigated away while the permission prompt was up.
      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      // Some webcams ship with a digital zoom applied, which crops the frame
      // and cuts heads off. Reset it to the widest setting when the camera
      // exposes that control.
      const track = stream.getVideoTracks()[0]
      const capabilities = track?.getCapabilities?.() || {}
      if (capabilities.zoom && typeof capabilities.zoom.min === 'number') {
        track
          .applyConstraints({ advanced: [{ zoom: capabilities.zoom.min }] })
          .catch((err) => console.warn('[camera] Could not reset zoom:', err.message))
      }

      if (DEBUG_CAMERA) {
        const settings = track?.getSettings?.() || {}
        const { w: targetWidth, h: targetHeight } = getBoothSize(isVerticalRef.current)
        const sW = settings.width || targetWidth
        const sH = settings.height || targetHeight
        const aspectRatio = typeof settings.aspectRatio === 'number'
          ? settings.aspectRatio.toFixed(2)
          : 'n/a'
        const cover = computeCoverRect(sW, sH, targetWidth, targetHeight)
        const pW = Math.round(cover.renderW * getPersonZoom(isVerticalRef.current))
        const pH = Math.round(cover.renderH * getPersonZoom(isVerticalRef.current))
        setDebugCamera({
          source: `${sW}×${sH}`,
          aspectRatio,
          canvas: `${targetWidth}×${targetHeight}`,
          personFrame: `${pW}×${pH}`,
          personTop: Math.round(targetHeight - pH),
          zoom: capabilities.zoom ? `${capabilities.zoom.min}–${capabilities.zoom.max}` : 'not supported'
        })
      }

      if (!videoRef.current) {
        // The booth unmounted between the permission prompt and the stream.
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      videoRef.current.onloadedmetadata = null
      videoRef.current.srcObject = stream
      setIsCameraOpen(true)
      isCameraOpenRef.current = true
      setCapturedImage(null)
      // A new stream needs a fresh mask before capture is allowed again.
      segmentationMaskRef.current = null
      setIsSegmentationReady(false)

      // Registered once per stream, not once per call.
      videoRef.current.onloadedmetadata = () => {
        const video = videoRef.current
        if (!video || !isCameraOpenRef.current) return

        // Safari can leave a freshly assigned video paused.
        const playPromise = video.play()
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {})
        }

        if (renderFrameRef.current) {
          cancelAnimationFrame(renderFrameRef.current)
          renderFrameRef.current = null
        }
        runFrameLoop()
      }
    } catch (err) {
      console.error('Error accessing camera:', err)
      setError('Unable to access your camera. Please ensure camera permissions are allowed in your browser settings.')
    } finally {
      if (requestId === cameraRequestIdRef.current) {
        startingRef.current = false
      }
    }
  }

  const clearCountdownTimers = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current)
      countdownTimeoutRef.current = null
    }
  }

  const stopCamera = () => {
    clearCountdownTimers()
    // Invalidate any getUserMedia call still in flight and unblock future ones.
    cameraRequestIdRef.current += 1
    startingRef.current = false
    if (videoRef.current) {
      videoRef.current.onloadedmetadata = null
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks()
      tracks.forEach((track) => track.stop())
      videoRef.current.srcObject = null
    }
    if (renderFrameRef.current) {
      cancelAnimationFrame(renderFrameRef.current)
      renderFrameRef.current = null
    }
    setIsCameraOpen(false)
    isCameraOpenRef.current = false
    segmentationMaskRef.current = null
    setIsSegmentationReady(false)
    setIsCountingDown(false)
    setCountdown(null)
  }

  // The Google Translate widget is mounted outside React (see index.html) and
  // only visible on the landing page.
  useEffect(() => {
    document.body.classList.toggle('landing-active', showLanding)
  }, [showLanding])

  // Auto-start camera immediately when entering the Camera & Photo Booth page
  useEffect(() => {
    if (!showLanding && !showInstructions && !showBackgroundSelector && !capturedImage) {
      if (!isCameraOpenRef.current) {
        startCamera()
      }
    }
  }, [showLanding, showInstructions, showBackgroundSelector, capturedImage])

  // Restart the stream when the screen orientation changes so the video
  // constraints and composite canvas switch between portrait and landscape.
  useEffect(() => {
    if (isCameraOpenRef.current) {
      stopCamera()
      startCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVertical])

  // Capture Photo with Keepsake Framing adapting to Vertical & Horizontal layouts
  const executeCapture = useCallback(() => {
    if (!compositeCanvasRef.current) return
    const video = videoRef.current
    if (video && video.videoWidth && video.videoHeight) {
      drawCompositedFrame(video)
    }

    // Trigger visual camera flash
    setIsFlashActive(true)
    setTimeout(() => setIsFlashActive(false), 300)

    const sourceCanvas = compositeCanvasRef.current
    // Reuse one canvas: allocating a new full-size bitmap on every capture is
    // a large, avoidable memory spike on Safari.
    const framedCanvas = captureCanvasRef.current || document.createElement('canvas')
    captureCanvasRef.current = framedCanvas
    framedCanvas.width = sourceCanvas.width
    framedCanvas.height = sourceCanvas.height
    const framedCtx = framedCanvas.getContext('2d')

    // 1. Draw composite image
    framedCtx.drawImage(sourceCanvas, 0, 0)

    const width = framedCanvas.width
    const height = framedCanvas.height

    // 2. Add Crisp Ultra-Slim All-Black Keepsake Frame
    const minSide = Math.min(width, height)
    const frameThickness = Math.max(3, Math.round(minSide * 0.006))

    framedCtx.strokeStyle = '#000000'
    framedCtx.lineWidth = frameThickness
    framedCtx.strokeRect(
      frameThickness / 2,
      frameThickness / 2,
      width - frameThickness,
      height - frameThickness
    )

    // JPEG keeps the payload ~10-20x smaller than PNG (350-700 KB vs 3-8 MB),
    // which is the single biggest factor in email send time.
    const dataUrl = framedCanvas.toDataURL('image/jpeg', 0.9)
    setCapturedImage(dataUrl)
    stopCamera()
  }, [])

  // Countdown Handler
  const startCountdownAndCapture = () => {
    // Never capture a frame the AI hasn't processed: the result would be the
    // landmark on its own.
    if (!isSegmentationReady) return
    clearCountdownTimers()
    setIsCountingDown(true)
    setCountdown(3)

    let current = 3
    countdownIntervalRef.current = setInterval(() => {
      current -= 1
      if (current > 0) {
        setCountdown(current)
      } else {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
        setCountdown('Smile!')
        countdownTimeoutRef.current = setTimeout(() => {
          executeCapture()
          setIsCountingDown(false)
          setCountdown(null)
          countdownTimeoutRef.current = null
        }, 600)
      }
    }, 1000)
  }

  const retakePhoto = () => {
    setCapturedImage(null)
    setEmail('')
    setEmailMessage('')
    setEmailStatusType('idle')
    startCamera()
  }

  const handleSendEmail = async () => {
    const normalizedEmail = email.trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!normalizedEmail) {
      setEmailMessage('Please enter your email address.')
      setEmailStatusType('error')
      return
    }

    if (!emailRegex.test(normalizedEmail)) {
      setEmailMessage('Please enter a valid email address.')
      setEmailStatusType('error')
      return
    }

    if (!capturedImage) {
      setEmailMessage('No captured photo found. Please capture a photo first.')
      setEmailStatusType('error')
      return
    }

    setIsSendingEmail(true)
    setEmailMessage('Sending your Gujarat memory...')
    setEmailStatusType('loading')

    try {
      console.log(`[PhotoBooth] Initiating email send to: ${normalizedEmail} | Landmark: ${selectedDestination?.name || 'Vibrant Gujarat'}`)
      const response = await fetch(`${API_BASE}/api/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          toEmail: normalizedEmail,
          imageDataUrl: capturedImage,
          landmarkName: selectedDestination?.name || 'Vibrant Gujarat',
          backgroundName: selectedDestination?.name || 'Vibrant Gujarat'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        console.error('[PhotoBooth] Email send failed on server:', data)
        setEmailMessage(data?.message || 'Failed to send email. Please try again.')
        setEmailStatusType('error')
        return
      }

      console.log('[PhotoBooth] Email sent successfully:', data)
      setEmailMessage(`Photo successfully sent to ${normalizedEmail}`)
      setEmailStatusType('success')
    } catch (err) {
      console.error('[PhotoBooth] Send email failed:', err)
      setEmailMessage('Unable to connect to email server. Please check your connection and try again.')
      setEmailStatusType('error')
    } finally {
      setIsSendingEmail(false)
    }
  }

  // Navigation Handlers
  const handleStartFromLanding = () => {
    setSelectedDestination(null)
    setShowLanding(false)
    setShowInstructions(true)
  }

  const handleProceedFromInstructions = () => {
    setSelectorSource('instructions')
    setSelectedDestination(null)
    setShowInstructions(false)
    setShowBackgroundSelector(true)
  }

  const handleBackFromSelector = () => {
    setShowBackgroundSelector(false)
    if (selectorSource === 'camera') {
      // Returning to the booth: the auto-start effect is the single place that
      // opens the camera, so it can never be opened twice.
      return
    }
    setShowInstructions(true)
  }

  const handleBackFromCamera = () => {
    stopCamera()
    setCapturedImage(null)
    setEmail('')
    setEmailMessage('')
    setEmailStatusType('idle')
    setShowBackgroundSelector(true)
  }

  const handleGoToLanding = () => {
    stopCamera()
    setCapturedImage(null)
    setEmail('')
    setEmailMessage('')
    setEmailStatusType('idle')
    setSelectedDestination(null)
    setShowLanding(true)
    setShowInstructions(false)
    setShowBackgroundSelector(false)
  }

  const handleBackgroundSelect = (dest) => {
    setSelectedDestination(dest)
    setShowBackgroundSelector(false)
    // The auto-start effect opens the camera once the booth view is shown.
  }

  // View: Landing Page
  if (showLanding) {
    return (
      <LandingPage
        onStart={handleStartFromLanding}
        isVertical={isVertical}
      />
    )
  }

  // View: Instructions
  if (showInstructions) {
    return (
      <InstructionsPage
        onBack={handleGoToLanding}
        onProceed={handleProceedFromInstructions}
        isVertical={isVertical}
      />
    )
  }

  // View: Background Selector
  if (showBackgroundSelector) {
    return (
      <div className="page-transition">
        <BackgroundSelector
          onSelect={handleBackgroundSelect}
          onBack={handleBackFromSelector}
          initialSelectedId={selectedDestination?.id}
          isVertical={isVertical}
        />
      </div>
    )
  }

  // View: Camera & Photo Booth
  return (
    <div className={`gender-detection-page ${isVertical ? 'booth-vertical-screen' : 'booth-horizontal-screen'}`}>
      {/* Visual Shutter Flash */}
      {isFlashActive && <div className="camera-shutter-flash"></div>}

      {DEBUG_CAMERA && (debugCamera || debugMask) && (
        <div className="camera-debug-badge">
          {debugCamera && (
            <>
              <span>camera {debugCamera.source}</span>
              <span>aspect {debugCamera.aspectRatio}</span>
              <span>canvas {debugCamera.canvas}</span>
              <span>person {debugCamera.personFrame} @ y={debugCamera.personTop}</span>
              <span>zoom {debugCamera.zoom}</span>
            </>
          )}
          <span>
            mask {debugMask ? debugMask.mode : 'waiting'} · fg {debugMask ? Math.round(debugMask.fg * 100) : 0}%
          </span>
          {debugMask && (
            <>
              <span>alpha {debugMask.alpha} · lum {debugMask.lum}</span>
              <span>size {debugMask.width}×{debugMask.height}</span>
            </>
          )}
        </div>
      )}

      <header className="booth-top-bar">
        <LandingLogo />
        <div className="booth-destination-indicator">
          <span className="dest-location">{selectedDestination?.location || selectedDestination?.name}</span>
        </div>
        <div className="booth-nav-group">
          <button className="back-nav-btn" onClick={handleBackFromCamera} title="Back to Backgrounds">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Back</span>
          </button>
          <button className="home-nav-btn" onClick={handleGoToLanding} title="Home">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
            <span>Home</span>
          </button>
        </div>
      </header>

      <div className="detection-content">
        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {isLoading && (
          <div className="loading">
            <div className="spinner"></div>
            <p>Initializing AI Neural Models & Gujarat Backdrops...</p>
          </div>
        )}

        {segmentationError && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            <span>{segmentationError}</span>
          </div>
        )}

        <div className="booth-main-container">
          <div className={`camera-card ${isVertical ? 'card-vertical' : 'card-horizontal'}`}>
            <div className={`camera-preview ${isVertical ? 'preview-vertical' : 'preview-horizontal'}${isVertical && IS_MOBILE ? ' preview-phone' : ''}`}>
              {/* Countdown hint — the preview stays completely clear */}
              {isCountingDown && (
                <div className="countdown-hint" role="status" aria-live="polite">
                  <span className="countdown-hint-dot" aria-hidden="true"></span>
                  <span>Look at the camera…</span>
                </div>
              )}

              {!capturedImage && isCameraOpen && !isSegmentationReady && !segmentationError && (
                <div className="countdown-hint" role="status" aria-live="polite">
                  <span className="countdown-hint-dot" aria-hidden="true"></span>
                  <span>Preparing AI…</span>
                </div>
              )}

              {capturedImage ? (
                <div className="captured-view-wrapper">
                  <img src={capturedImage} alt="Captured Souvenir" className="captured-image" />
                </div>
              ) : (
                <>
                  {selectedDestination && (
                    <div
                      className="background-overlay"
                      style={{
                        backgroundImage: `url(${getDestinationImagePath(selectedDestination, isVertical)})`
                      }}
                    ></div>
                  )}
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="video-source"
                  ></video>
                  <canvas ref={compositeCanvasRef} className="composite-canvas"></canvas>
                </>
              )}
            </div>

            {/* Controls bar */}
            <div className="booth-controls-toolbar">
              {isCameraOpen && !capturedImage && (
                <div className="active-camera-actions">
                  <button
                    onClick={startCountdownAndCapture}
                    className={`take-photo-btn primary-glow${isCountingDown ? ' is-counting' : ''}`}
                    disabled={isCountingDown || !isSegmentationReady}
                    title={isSegmentationReady ? undefined : 'Preparing AI…'}
                  >
                    {isCountingDown ? (
                      <>
                        <svg className="shutter-ring" viewBox="0 0 100 100" aria-hidden="true">
                          <circle className="shutter-ring-track" cx="50" cy="50" r="46" />
                          {typeof countdown === 'number' && (
                            <circle className="shutter-ring-progress" cx="50" cy="50" r="46" />
                          )}
                        </svg>
                        <span
                          key={countdown}
                          className={`shutter-count${typeof countdown === 'number' ? '' : ' is-word'}`}
                        >
                          {countdown}
                        </span>
                      </>
                    ) : (
                      <>
                        <svg className="camera-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                          <circle cx="12" cy="13" r="4"></circle>
                        </svg>
                        <span>Capture Photo (3s Timer)</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {capturedImage && (
                <div className="post-capture-actions">
                  <button onClick={retakePhoto} className="retake-photo-btn">
                    <span>↺ Retake Photo</span>
                  </button>
                </div>
              )}
            </div>

            {/* Post-Capture Email Section */}
            {capturedImage && (
              <div className="email-card-section">
                <div className="email-card-header">
                  <h4>Email Your Gujarat Memory</h4>
                </div>
                <div className="email-input-row">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      if (emailMessage) setEmailMessage('')
                    }}
                    className="email-input"
                    placeholder="Enter your email address..."
                  />
                  <button
                    onClick={handleSendEmail}
                    className="send-email-btn"
                    disabled={isSendingEmail}
                  >
                    {isSendingEmail ? (
                      <>
                        <span className="mini-spinner"></span>
                        <span>Sending...</span>
                      </>
                    ) : (
                      <span>Send to Email</span>
                    )}
                  </button>
                </div>
                {emailMessage && (
                  <p className={`email-status-message ${emailStatusType}`}>
                    {emailMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
