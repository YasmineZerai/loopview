// Dev-only: open the hosted demo build and screenshot it after the autoplay
// has run for a while. Serve dist-pages under a sub-path first, as GitHub Pages does.
// Usage: node scripts/check-pages.mjs <url> <out dir>
import { chromium } from 'playwright'

const [url = 'http://127.0.0.1:4450/loopview/', out = 'shots'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('requestfailed', (r) => errors.push(`failed: ${r.url()}`))
await page.goto(url)
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/pages-start.png` })
await page.waitForTimeout(9000)
await page.screenshot({ path: `${out}/pages-autoplay.png` })
console.log(errors.length ? errors.join('\n') : 'no errors')
await browser.close()
