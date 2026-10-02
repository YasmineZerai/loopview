// Dev-only: screenshot the Cost tab in both themes, for the whole run, one step,
// mid-replay, and with a segment hovered.
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
  if (s.panel !== 'cost') s.togglePanel('cost')
  if (s.theme !== 'light') s.toggleTheme()
})
await settle()

for (const theme of ['light', 'dark']) {
  await page.screenshot({ path: `${out}/cost-run-${theme}.png` })

  // Hover the largest segment of the main bar: its cards light up in the graph.
  const bar = page.locator('aside .cost-cache').first()
  if (await bar.count()) {
    await bar.hover()
    await settle(500)
    await page.screenshot({ path: `${out}/cost-hover-${theme}.png` })
    await page.mouse.move(10, 500)
  }

  // Click the most expensive step: the tab filters to it and the graph centres it.
  await page.getByRole('button').filter({ hasText: /\$0\.\d+$/ }).first().click()
  await settle()
  await page.screenshot({ path: `${out}/cost-step-${theme}.png` })
  await page.keyboard.press('Escape')
  await settle(600)

  // Mid-replay: only what was spent by then.
  await state(() => {
    const s = window.__loopview.getState()
    const run = s.loaded.get(s.selectedRunId).run
    s.setPlayback({ time: run.start_ns + 9e9, playing: false })
  })
  await settle()
  await page.screenshot({ path: `${out}/cost-replay-${theme}.png` })
  await state(() => window.__loopview.getState().setPlayback({ time: Infinity, playing: false }))
  await state(() => window.__loopview.getState().toggleTheme())
  await settle()
}

console.log(errors.length ? errors.join('\n') : 'no errors')
await browser.close()
