// Dev-only: screenshot the activity feed with thinking visible, in both themes.
// Usage: node scripts/check-feed.mjs <base url> <out dir>
import { chromium } from 'playwright'

const [base = 'http://127.0.0.1:4400', out = 'shots'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } })
await page.goto(base)
await page.waitForTimeout(800)
const demo = page.getByRole('button', { name: /Load the demo run/ })
if (await demo.count()) await demo.click()
await page.waitForTimeout(1500)

// Stop just after the analysts' first model calls, which carry thinking.
await page.evaluate(() => {
  const s = window.__loopview.getState()
  const run = s.loaded.get(s.selectedRunId).run
  s.setPlayback({ time: run.start_ns + 6.2e9, playing: false })
})
await page.waitForTimeout(900)
await page.evaluate(() => {
  const feed = [...document.querySelectorAll('div')].find((d) => d.className.includes('overflow-y-auto') && d.className.includes('space-y-2'))
  if (feed) feed.scrollTop = 0
})
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/feed-light.png` })

await page.evaluate(() => window.__loopview.getState().toggleTheme())
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/feed-dark.png` })
await page.evaluate(() => window.__loopview.getState().toggleTheme()) // back to light
await browser.close()
console.log('done')
