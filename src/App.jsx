import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

const SELFIE_SEGMENTATION_SCRIPT = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js'

// API origin. Empty by default so local development keeps using the relative
// "/api" path (proxied to localhost:3001 by Vite). In production the frontend
// is hosted separately from the API, so VITE_API_URL points at the API host.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// How large the visitor's cut-out appears against the landmark (1.0 = 100% full frame).
const PERSON_ZOOM_VERTICAL = 0.8
const PERSON_ZOOM_HORIZONTAL = 1.0
const getPersonZoom = (vertical) => (vertical ? PERSON_ZOOM_VERTICAL : PERSON_ZOOM_HORIZONTAL)

// Detect mobile devices so we can adapt the AI model, camera constraints,
// and render loop accordingly.
const IS_MOBILE =
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

// Append ?debug=1 to the URL to print the camera mode and the person frame
// geometry on screen. Handy on a kiosk, where the browser console is not
// reachable. Hidden by default.
const DEBUG_CAMERA =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')

// Smaller on phones: 1080x1920 + per-frame segmentation is heavy on mobile GPUs
const getBoothSize = (vertical) => {
  const long = IS_MOBILE ? 1280 : 1920
  const short = IS_MOBILE ? 720 : 1080
  return vertical ? { w: short, h: long } : { w: long, h: short }
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

function LandingPage({ onStart, isVertical }) {
  const [currentSlide, setCurrentSlide] = useState(0)

  // 5 Featured Hero Slides from client's 15 destinations
  const heroSlideIds = ['14.webp', '3.webp', '13.webp', '11.webp', '9.webp']
  const heroDestinations = heroSlideIds.map((file) =>
    GUJARAT_DESTINATIONS.find((d) => d.file === file)
  )

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroDestinations.length)
    }, 4500)
    return () => clearInterval(timer)
  }, [heroDestinations.length])

  return (
    <div className={`landing-page ${isVertical ? 'orientation-vertical' : 'orientation-horizontal'}`}>
      {/* Background Slideshow */}
      <div className="slideshow-container">
        {heroDestinations.map((dest, index) => (
          <div
            key={dest.id}
            className={`Slide ${index === currentSlide ? 'active' : ''}`}
            style={{
              backgroundImage: `url(${getDestinationImagePath(dest, isVertical)})`
            }}
          />
        ))}
        <div className="slide-overlay"></div>
      </div>

      {/* Top Navbar */}
      <nav className="landing-navbar">
        <div className="navbar-left">
          <img
            src="/assets/gujarat-tourism-logo.png"
            alt="Gujarat Tourism Logo"
            className="navbar-brand-logo"
          />
        </div>

        <div className="navbar-right" />
      </nav>

      {/* Main Hero Content */}
      <div className="landing-content-wrapper">
        <div className="landing-content">
          <span className="landing-tagline">Explore the vibrant spirit of Gujarat.</span>
          <h1 className="landing-title">
            Welcome to the Land of Legends – Gujarat
          </h1>
          <p className="landing-description">
            Embark on a journey through vibrant cultures, majestic heritage, and breathtaking landscapes.
            From the timeless white sands of the Rann of Kutch to the sacred shores of Somnath and the
            wilderness of Gir, discover a land where history, spirituality, and adventure come alive.
          </p>
          <button className="start-journey-btn" onClick={onStart}>
            Start Your Journey
          </button>
        </div>
      </div>

      {/* Bottom Footer */}
      <footer className="landing-footer">
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
      {/* Top Navbar matching brand identity */}
      <nav className="instructions-navbar">
        <div className="navbar-left">
          <div className="navbar-brand-text">
            <span className="brand-title">GUJARAT TOURISM</span>
            <span className="brand-tagline">Land of Legends</span>
          </div>
        </div>

        <div className="navbar-right">
          <button className="selector-back-button" onClick={onBack} title="Go Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Back</span>
          </button>
        </div>
      </nav>

      {/* Main Instructions Card Container */}
      <main className="instructions-content-wrap">
        <div className="instructions-clean-card">
          <div className="instructions-clean-header">
            <h1 className="instructions-clean-title">How It Works</h1>
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
      <div className="selector-header-bar">
        <h2 className="selector-title">Choose Your Background</h2>
        <button className="selector-back-button" onClick={onBack} title="Go Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Back</span>
        </button>
      </div>

      <div className={`background-grid ${isVertical ? 'grid-vertical' : 'grid-horizontal'}`}>
        {GUJARAT_DESTINATIONS.map((dest) => {
          const isSelected = selectedDest?.id === dest.id
          const imageSrc = getDestinationImagePath(dest, isVertical)

          return (
            <div
              key={dest.id}
              className={`background-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handleCardClick(dest)}
            >
              <div className="card-image-wrap">
                <img src={imageSrc} alt={dest.name} loading="lazy" />
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
  const isCameraOpenRef = useRef(false)
  const backgroundImageRef = useRef(null)
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
  const [error, setError] = useState(null)
  const [capturedImage, setCapturedImage] = useState(null)
  const [email, setEmail] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailStatusType, setEmailStatusType] = useState('idle')
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [debugCamera, setDebugCamera] = useState(null)

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
          segmentationMaskRef.current = results.segmentationMask
          segmentationBusyRef.current = false
        })

        segmentationModelRef.current = model
        segmentationReadyRef.current = true
        setIsLoading(false)
      } catch (err) {
        console.error('Error loading segmentation model:', err)
        segmentationReadyRef.current = false
        setIsLoading(false)
      }
    }

    loadSegmentationModel()

    return () => {
      mounted = false
    }
  }, [])

  // Preload Selected Destination Background Image (matches the booth orientation)
  useEffect(() => {
    if (!selectedDestination) {
      backgroundImageRef.current = null
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      backgroundImageRef.current = img
    }
    img.src = getDestinationImagePath(selectedDestination, isVertical)
    if (img.complete && img.naturalWidth !== 0) {
      backgroundImageRef.current = img
    }
  }, [selectedDestination, isVertical])

  // Draw Composited Canvas Frame (16:9 landscape or 9:16 portrait, sized for the device)
  const drawCompositedFrame = (video) => {
    if (!compositeCanvasRef.current || !personCanvasRef.current || !video) return

    const compositeCanvas = compositeCanvasRef.current
    const personCanvas = personCanvasRef.current
    const selectedBgImage = backgroundImageRef.current

    // Standard 16:9 widescreen HD rectangle for desktop, 9:16 for portrait phones
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

    compositeCtx.clearRect(0, 0, targetWidth, targetHeight)

    // 1. Draw Landmark Background (orientation-matched full frame)
    if (selectedBgImage && selectedBgImage.complete && selectedBgImage.naturalWidth !== 0) {
      compositeCtx.drawImage(selectedBgImage, 0, 0, targetWidth, targetHeight)
    } else {
      compositeCtx.fillStyle = '#0f172a'
      compositeCtx.fillRect(0, 0, targetWidth, targetHeight)
    }

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
      personCtx.clearRect(0, 0, targetWidth, targetHeight)
      personCtx.filter = 'blur(2px)'
      drawMirroredCover(personCtx, mask, personX, personY, personW, personH, targetWidth)
      personCtx.filter = 'none'
      personCtx.globalCompositeOperation = 'source-in'
      drawMirroredCover(personCtx, video, personX, personY, personW, personH, targetWidth)

      // Soften the hard top edge of the camera frame when the person is shrunk
      if (personY > 0) {
        const regionH = targetHeight - personY
        const fadeH = Math.min(personH * 0.15, 140)
        const g = personCtx.createLinearGradient(0, personY, 0, targetHeight)
        g.addColorStop(0, 'rgba(0,0,0,0)')
        g.addColorStop(fadeH / regionH, 'rgba(0,0,0,1)')
        g.addColorStop(1, 'rgba(0,0,0,1)')
        personCtx.globalCompositeOperation = 'destination-in'
        personCtx.fillStyle = g
        personCtx.fillRect(0, personY, targetWidth, regionH)
      }
      personCtx.globalCompositeOperation = 'source-over'
      compositeCtx.drawImage(personCanvas, 0, 0, targetWidth, targetHeight)
    } else {
      // While AI initializes, draw the video over the canvas at 100%
      drawMirroredCover(compositeCtx, video, personX, personY, personW, personH, targetWidth)
    }
  }

  // Animation Frame Loop
  //
  // On mobile we throttle segmentation inference to ~20 FPS to avoid
  // overwhelming the mobile GPU / WebGL context, which causes mask drops.
  const lastSegTimeRef = useRef(0)
  const SEG_INTERVAL_MS = IS_MOBILE ? 50 : 0 // 50 ms ≈ 20 FPS on mobile

  const runFrameLoop = () => {
    const video = videoRef.current
    if (!video || !isCameraOpenRef.current) return

    if (!video.videoWidth || !video.videoHeight) {
      renderFrameRef.current = requestAnimationFrame(runFrameLoop)
      return
    }

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
          // On mobile, keep the last good mask instead of clearing it,
          // so the background remains visible even if a single frame errors.
          if (!IS_MOBILE) {
            segmentationMaskRef.current = null
          }
        })
    }

    renderFrameRef.current = requestAnimationFrame(runFrameLoop)
  }

  const startCamera = async () => {
    try {
      setError(null)

      // Request a stream matching the booth orientation (9:16 portrait or 16:9 landscape)
      const vertical = isVerticalRef.current
      const constraints = {
        video: {
          width: { ideal: vertical ? 720 : 1280 },
          height: { ideal: vertical ? 1280 : 720 },
          facingMode: 'user'
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)

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
        const cover = computeCoverRect(sW, sH, targetWidth, targetHeight)
        const pW = Math.round(cover.renderW * getPersonZoom(isVerticalRef.current))
        const pH = Math.round(cover.renderH * getPersonZoom(isVerticalRef.current))
        setDebugCamera({
          source: `${sW}×${sH}`,
          canvas: `${targetWidth}×${targetHeight}`,
          personFrame: `${pW}×${pH}`,
          personTop: Math.round(targetHeight - pH),
          zoom: capabilities.zoom ? `${capabilities.zoom.min}–${capabilities.zoom.max}` : 'not supported'
        })
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setIsCameraOpen(true)
        isCameraOpenRef.current = true
        setCapturedImage(null)
        segmentationMaskRef.current = null

        videoRef.current.onloadedmetadata = () => {
          runFrameLoop()
        }
      }
    } catch (err) {
      console.error('Error accessing camera:', err)
      setError('Unable to access your camera. Please ensure camera permissions are allowed in your browser settings.')
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
    const framedCanvas = document.createElement('canvas')
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
      startCamera()
    } else {
      setShowInstructions(true)
    }
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
    startCamera()
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

      {DEBUG_CAMERA && debugCamera && (
        <div className="camera-debug-badge">
          <span>camera {debugCamera.source}</span>
          <span>canvas {debugCamera.canvas}</span>
          <span>person {debugCamera.personFrame} @ y={debugCamera.personTop}</span>
          <span>zoom {debugCamera.zoom}</span>
        </div>
      )}

      <header className="booth-top-bar">
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
        <div className="booth-destination-indicator">
          <span className="dest-location">{selectedDestination?.location || selectedDestination?.name}</span>
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

        <div className="booth-main-container">
          <div className={`camera-card ${isVertical ? 'card-vertical' : 'card-horizontal'}`}>
            <div className={`camera-preview ${isVertical ? 'preview-vertical' : 'preview-horizontal'}`}>
              {/* Countdown hint — the preview stays completely clear */}
              {isCountingDown && (
                <div className="countdown-hint" role="status" aria-live="polite">
                  <span className="countdown-hint-dot" aria-hidden="true"></span>
                  <span>Look at the camera…</span>
                </div>
              )}

              {isCameraOpen && !capturedImage && !isCountingDown && (
                <div className="countdown-hint" role="note">
                  <span>Hold the phone a little farther away</span>
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
                    disabled={isCountingDown}
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
