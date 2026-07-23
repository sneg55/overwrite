// Renders each schematic in this directory to a PNG in media/schematics/ (tracked,
// embedded in the root README). No network, no key, no API.
//
// Each diagram is its own .html linking base.css, and the screenshot is taken of the
// .slide element rather than a fixed viewport clip, so a diagram's height follows its
// content and no slide needs a hand-tuned rectangle.

import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', '..', 'schematics')

// 1600 CSS px at 1.5x renders 2400px wide: sharp on a retina display at the ~900px
// GitHub renders a README image, without shipping a needlessly huge file.
const WIDTH = 1600
const SCALE = 1.5

const SLIDES = ['epoch-lifecycle', 'privacy-model', 'architecture']

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: WIDTH, height: 900 },
  deviceScaleFactor: SCALE,
})
try {
  for (const id of SLIDES) {
    await page.goto(`file://${path.join(__dirname, `${id}.html`)}`, { waitUntil: 'load' })
    const slide = page.locator('.slide')
    const dest = path.join(OUT, `${id}.png`)
    await slide.screenshot({ path: dest })
    const box = await slide.boundingBox()
    console.log(`  ${id} -> media/schematics/${id}.png (${box.width}x${Math.round(box.height)} css px)`)
  }
} catch (e) {
  console.error('render-schematics failed:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
