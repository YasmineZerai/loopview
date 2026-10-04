// Dev-only: screenshot the Tools tab in both themes: the table, a tool opened,
// and the jump from an error to its step in the graph.
// Usage: start a server with some runs that have tool errors, e.g. every fixture:
//   cat ../fixtures/*.otlp.jsonl > /tmp/all.jsonl
//   (cd ../server && uv run loopview --port 4471 --no-browser --persist /tmp/all.jsonl)
//   node scripts/check-tools.mjs http://127.0.0.1:4471 <out dir>
import { chromium } from 'playwright'

const [base = 'http://127.0.0.1:4471', out = 'shots'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const state = (fn, arg) => page.evaluate(fn, arg)
const settle = (ms = 1200) => page.waitForTimeout(ms)

await page.goto(base)
await settle(1500)
await state(() => {
  const s = window.__loopview.getState()
  if (s.theme !== 'light') s.toggleTheme()
})

for (const theme of ['light', 'dark']) {
  await page.keyboard.press('o')
  await settle()
  await page.screenshot({ path: `${out}/tools-table-${theme}.png` })

  // Open the tool with the most errors (the first row by default).
  await page.locator('tbody tr').first().click()
  await settle(500)
  await page.screenshot({ path: `${out}/tools-detail-${theme}.png`, fullPage: true })

  // Jump to the step: the graph shows the run with the card open and centred.
  await page.getByRole('button', { name: /Show this call in the graph/ }).first().click()
  await settle(2200)
  await page.screenshot({ path: `${out}/tools-jump-${theme}.png` })
  const view = await state(() => window.__loopview.getState().view)
  if (view !== 'graph') errors.push(`expected the graph after a jump, got ${view}`)

  await state(() => window.__loopview.getState().toggleTheme())
  await page.keyboard.press('Escape')
  await settle(400)
}

console.log(errors.length ? errors.join('\n') : 'no errors')
await browser.close()
