// One-off thumbnail generator for the background picker.
//
//   npm install --no-save --no-package-lock sharp
//   node scripts/make-thumbs.mjs
//
// Reads the full-size HD images and writes 640px-wide WebP copies to
// public/destinations/Thumbs/{Vertical,Horizontal}. The booth keeps using the
// HD originals; only the picker grid uses these smaller files.
//
// This script is not part of the Vite build and sharp is not a project
// dependency.
import { mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const destinationsDir = path.join(projectRoot, 'public', 'destinations')

const GROUPS = [
  { source: 'Vertical HD', output: 'Vertical' },
  { source: 'Horizontal HD', output: 'Horizontal' }
]

const THUMB_WIDTH = 420
const QUALITY = 65

let totalBytes = 0

for (const group of GROUPS) {
  const sourceDir = path.join(destinationsDir, group.source)
  const outputDir = path.join(destinationsDir, 'Thumbs', group.output)
  await mkdir(outputDir, { recursive: true })

  const files = (await readdir(sourceDir)).filter((file) => file.endsWith('.webp')).sort()

  for (const file of files) {
    const target = path.join(outputDir, file)
    await sharp(path.join(sourceDir, file))
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(target)

    const { size } = await stat(target)
    totalBytes += size
    console.log(`${group.output}/${file}  ${(size / 1024).toFixed(1)} KB`)
  }
}

console.log(`\nDone. ${(totalBytes / 1024 / 1024).toFixed(2)} MB total.`)
