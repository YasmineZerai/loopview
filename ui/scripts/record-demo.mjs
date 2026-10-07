// Dev-only: record frames of the flagship demo replay, for the README GIF.
// Usage: start a fresh server, then  node scripts/record-demo.mjs <base url> <out dir>
// Then assemble with scripts/make_gif.py.
//
// Replay time is stepped evenly through the page's store (window.__loopview)
// instead of playing in real time, because screenshots of an animating page take
// an uneven amount of time and would give a jerky GIF.
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// One frame every 440 ms of the run, shown for 220 ms: the GIF plays at 2x. The camera
// moves on most frames now (it follows the active cards), which GIFs compress poorly,
// so fewer frames keep it near 6 MB.
const [base = 'http://127.0.0.1:4400', out = 'frames', stepMs = '440'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } })
await page.goto(base)
await page.waitForTimeout(900)
await page.getByRole('button', { name: /Load the demo run/ }).click()
await page.waitForTimeout(1800)

const { start, end } = await page.evaluate(() => {
  const s = window.__loopview.getState()
  const run = s.loaded.get(s.selectedRunId).run
  return { start: run.start_ns, end: run.end_ns }
})

const frames = []
let i = 0
const shot = async (hold) => {
  const path = `${out}/f${String(i++).padStart(3, '0')}.png`
  await page.screenshot({ path })
  frames.push({ path, hold })
}
// With Activity on the camera frames the active card; the first and last frames,
// held longest, show the whole run instead (Fit).
await page.keyboard.press('f')
await page.waitForTimeout(700)
await shot(1200) // the finished run, before replay
for (let t = start; t <= end; t += Number(stepMs) * 1e6) {
  await page.evaluate((time) => window.__loopview.getState().setPlayback({ time, playing: false }), t)
  // Long enough for the camera to finish re-framing a grown graph (400 ms),
  // short enough to catch particles still travelling.
  await page.waitForTimeout(430)
  await shot(Number(stepMs) / 2)
}
await page.evaluate(() => window.__loopview.getState().setPlayback({ time: Infinity, playing: false }))
await page.waitForTimeout(600)
await page.keyboard.press('f')
await page.waitForTimeout(700)
await shot(2600)
await writeFile(`${out}/frames.json`, JSON.stringify(frames))
console.log(`${frames.length} frames`)
await browser.close()
