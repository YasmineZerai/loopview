// Dev-only: screenshot the cost tree in both themes: the whole run, a hovered
// branch, every step open, and mid-replay.
// Usage: start a fresh server (`uv run loopview --port 4470 --no-browser`), then
//   node scripts/check-cost.mjs http://127.0.0.1:4470 <out dir>
import { chromium } from 'playwright'

const [base = 'http://127.0.0.1:4470', out = 'shots'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const state = (fn, arg) => page.evaluate(fn, arg)
const settle = (ms = 1400) => page.waitForTimeout(ms)

await page.goto(base)
await settle(800)
await page.getByRole('button', { name: /Load the demo run/ }).click()
await settle(1800)
await state(() => {
  const s = window.__loopview.getState()
  if (s.theme !== 'light') s.toggleTheme()
})
await page.keyboard.press('c')
await page.mouse.move(5, 500)
await settle()

for (const theme of ['light', 'dark']) {
  await page.screenshot({ path: `${out}/tree-run-${theme}.png` })

  // Hover an agent: its branch stays lit, the rest fades.
  await page.locator('svg text', { hasText: 'ecosystem_analyst' }).first().hover()
  await settle(500)
  await page.screenshot({ path: `${out}/tree-hover-${theme}.png` })
  await page.mouse.move(5, 500)

  // Every step open.
  await page.getByRole('button', { name: 'Open all steps' }).click()
  await settle(900)
  await page.screenshot({ path: `${out}/tree-open-${theme}.png` })
  await page.getByRole('button', { name: 'Fold all steps' }).click()

  // Mid-replay: only what was spent by then.
  await state(() => {
    const s = window.__loopview.getState()
    const run = s.loaded.get(s.selectedRunId).run
    s.setPlayback({ time: run.start_ns + 9e9, playing: false })
  })
  await settle()
  await page.screenshot({ path: `${out}/tree-replay-${theme}.png` })
  await state(() => window.__loopview.getState().setPlayback({ time: Infinity, playing: false }))
  await state(() => window.__loopview.getState().toggleTheme())
  await settle()
}

console.log(errors.length ? errors.join('\n') : 'no errors')
await browser.close()
