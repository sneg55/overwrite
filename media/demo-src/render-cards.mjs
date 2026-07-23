// Renders each card/term scene from scenes.json to a 1920x1080 PNG in out/cards/,
// plus a transparent lower-third caption strip per UI scene in out/captions/.
// No network, no key. UI scenes (kind: "ui") get only the caption strip; testreel
// supplies the footage itself.
//
// The captions are PNGs composited with ffmpeg's `overlay` rather than text drawn by
// `drawtext`, because the Homebrew ffmpeg on this machine is built without
// libfreetype and so has no drawtext filter at all. Rendering them here also means
// the caption typography comes from the same browser as everything else.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const scenes = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenes.json'), 'utf8'))
const OUT = path.join(__dirname, 'out', 'cards')
fs.mkdirSync(OUT, { recursive: true })
const stageUrl = 'file://' + path.join(__dirname, 'cards', 'stage.html')

const cards = scenes.filter((s) => s.kind === 'card' || s.kind === 'term')
console.log(`Rendering ${cards.length} card/term scenes...`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
try {
  await page.goto(stageUrl, { waitUntil: 'load' })
  for (const scene of cards) {
    await page.evaluate((s) => window.__show(s), scene)
    await page.waitForTimeout(250)
    const dest = path.join(OUT, `${scene.id}.png`)
    await page.screenshot({ path: dest, clip: { x: 0, y: 0, width: 1920, height: 1080 } })
    console.log(`  ${scene.id} -> ${path.relative(__dirname, dest)}`)
  }
  // Caption strips: 1920x104, transparent outside the pill, so the overlay sits on
  // the footage without a full-width band across the bottom of the frame.
  const CAPS = path.join(__dirname, 'out', 'captions')
  fs.mkdirSync(CAPS, { recursive: true })
  const captioned = scenes.filter((s) => s.kind === 'ui' && typeof s.caption === 'string')
  console.log(`Rendering ${captioned.length} caption strips...`)
  const strip = await browser.newPage({ viewport: { width: 1920, height: 104 } })
  await strip.goto(`file://${path.join(__dirname, 'cards', 'caption.html')}`, { waitUntil: 'load' })
  for (const scene of captioned) {
    await strip.evaluate((t) => window.__caption(t), scene.caption)
    await strip.waitForTimeout(120)
    const dest = path.join(CAPS, `${scene.id}.png`)
    await strip.screenshot({ path: dest, omitBackground: true })
    console.log(`  ${scene.id} -> ${path.relative(__dirname, dest)}`)
  }
} catch (e) {
  console.error('render-cards failed:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
