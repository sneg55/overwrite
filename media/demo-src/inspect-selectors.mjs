// Step 1 of the demo-video pipeline: verify selectors against the LIVE app before
// writing any testreel steps. Screenshots each route and dumps every interactive
// element with a selector that would actually resolve.
//
//   node inspect-selectors.mjs            # all routes, operator party
//   node inspect-selectors.mjs alice      # switch party cookie first
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.WEB_URL || 'http://localhost:3000'
const PARTY = process.argv[2] || 'operator'
const OUT = path.join(__dirname, 'out', 'inspect')
const ROUTES = ['/', '/app', '/app/position', '/app/reports']

fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
// The acting party is a plain cookie the switcher's server action writes.
await ctx.addCookies([
  { name: 'overwrite-party', value: PARTY, url: BASE },
  { name: 'party', value: PARTY, url: BASE },
])
const page = await ctx.newPage()

for (const route of ROUTES) {
  const slug = route === '/' ? 'root' : route.replace(/\//g, '-').replace(/^-/, '')
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(OUT, `${PARTY}-${slug}.png`), fullPage: false })

  const els = await page.evaluate(() => {
    const sel = (el) => {
      if (el.id) return `#${el.id}`
      const tid = el.getAttribute('data-testid')
      if (tid) return `[data-testid="${tid}"]`
      const name = el.getAttribute('name')
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`
      const href = el.getAttribute('href')
      if (href && el.tagName === 'A') return `a[href="${href}"]`
      const txt = (el.textContent || '').trim().slice(0, 40)
      if (txt) return `${el.tagName.toLowerCase()}:has-text("${txt}")`
      return el.tagName.toLowerCase()
    }
    const out = []
    for (const el of document.querySelectorAll('a, button, input, select, [role="tab"], form')) {
      const r = el.getBoundingClientRect()
      out.push({
        tag: el.tagName.toLowerCase(),
        sel: sel(el),
        text: (el.textContent || el.value || '').trim().slice(0, 60),
        visible: r.width > 0 && r.height > 0,
        box: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      })
    }
    const headings = [...document.querySelectorAll('h1, h2, h3')].map((h) => h.textContent.trim().slice(0, 70))
    return { out, headings, title: document.title }
  })

  console.log(`\n=== ${route} (party=${PARTY}) : ${els.title}`)
  console.log('headings:', els.headings.join(' | '))
  for (const e of els.out.filter((e) => e.visible)) {
    console.log(`  ${e.tag.padEnd(7)} ${e.sel.padEnd(52)} [${e.box}] ${e.text}`)
  }
}

await browser.close()
console.log(`\nscreenshots -> ${path.relative(process.cwd(), OUT)}`)
