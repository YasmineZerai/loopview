// Dev-only: screenshot cards expanded inside the graph.
// Usage: start a fresh server, then  node scripts/check-expand.mjs <base url> <out dir>
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [base = 'http://127.0.0.1:4400', out = 'shots'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } })
const store = (fn, arg) => page.evaluate(fn, arg)
await page.goto(base)
await page.waitForTimeout(800)
await page.getByRole('button', { name: /Load the demo run/ }).click()
await page.waitForTimeout(1500)

// 1. Everything expanded, final state.
await page.keyboard.press('e')
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/expand-all.png` })
await page.keyboard.press('e')
await page.waitForTimeout(800)

// 2. One card expanded during replay: the ecosystem analyst's tools, mid-run.
await page.locator('.react-flow__node-step', { hasText: 'fetch_repo_stats' }).first().locator('button[title^="Show calls"]').click()
await store(() => {
  const s = window.__loopview.getState()
  const run = s.loaded.get(s.selectedRunId).run
  s.setPlayback({ time: run.start_ns + 8.5e9, playing: false })
})
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/expand-one-replay.png` })

// 3. The single agent run, expanded.
const body = await readFile(new URL('../../fixtures/react_anthropic.otlp.jsonl', import.meta.url))
const { trace_ids } = await (await fetch(`${base}/api/import`, { method: 'POST', body })).json()
await store((id) => window.__loopview.getState().selectRun(id, true), trace_ids[0])
await page.waitForTimeout(1500)
await page.locator('.react-flow__node-step').first().locator('button[title^="Show calls"]').click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/expand-single-agent.png` })

await browser.close()
console.log('done')
