// Dev-only: screenshot the UI repeatedly while a real agent runs against the server.
// Usage: node scripts/live-frames.mjs <base url> <out dir> <frames> <interval ms>
import { chromium } from 'playwright'

const [base = 'http://127.0.0.1:4400', out = 'frames', frames = '10', interval = '1500'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } })
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)))
await page.goto(base)
for (let i = 0; i < Number(frames); i++) {
  await page.waitForTimeout(Number(interval))
  await page.screenshot({ path: `${out}/live-${String(i).padStart(2, '0')}.png` })
}
console.log('done')
await browser.close()
