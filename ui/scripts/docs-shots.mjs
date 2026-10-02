// Dev-only: the screenshots used in the README (docs/*.png).
// Usage: start a fresh server (`uv run loopview --port 4460 --no-browser`), then
//   node scripts/docs-shots.mjs http://127.0.0.1:4460 ../docs
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [base = 'http://127.0.0.1:4460', out = '../docs'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1.5 })
const state = (fn, arg) => page.evaluate(fn, arg)
const settle = (ms = 1400) => page.waitForTimeout(ms)
const shot = async (name, clip) => {
  await page.screenshot({ path: `${out}/${name}.png`, clip })
  console.log(`saved ${name}.png`)
}
const importFixture = async (name) => {
  const body = await readFile(new URL(`../../fixtures/${name}.otlp.jsonl`, import.meta.url))
  return (await (await fetch(`${base}/api/import`, { method: 'POST', body })).json()).trace_ids[0]
}
const select = async (id) => {
  await state((runId) => window.__loopview.getState().selectRun(runId, true), id)
  await settle(1800)
}
const at = async (seconds) => {
  await state((s) => {
    const st = window.__loopview.getState()
    const run = st.loaded.get(st.selectedRunId).run
    st.setPlayback({ time: s === null ? Infinity : run.start_ns + s * 1e9, playing: false })
  }, seconds)
  await settle()
}

await page.goto(base)
await settle(800)
await state(() => window.__loopview.getState().theme === 'dark' && window.__loopview.getState().toggleTheme())
const reactId = await importFixture('react_anthropic')
const multiId = await importFixture('multi_agent_pydantic')
const flagshipId = (await (await fetch(`${base}/api/demo`, { method: 'POST' })).json()).trace_ids[0]

// 1. Hero: the flagship mid-run, three analysts working in parallel, feed open.
await select(flagshipId)
await at(9.2)
await shot('screenshot-graph')

// 2. A card expanded inside the graph: the single agent, thinking and tool calls.
await select(reactId)
await page.locator('.react-flow__node-step').first().locator('button[title^="Show calls"]').click()
await settle(1600)
await page.locator('.react-flow__node-step').first().locator('.overflow-y-auto').evaluate((el) => (el.scrollTop = 0))
await settle(300)
await shot('screenshot-expanded')
await page.locator('.react-flow__node-step').first().locator('button[title^="Hide calls"]').click()

// 3. Multi-agent: agents delegating to agents, then a handoff.
await select(multiId)
await shot('screenshot-multi-agent')

// 4. Dark theme, with the timeline open.
await select(flagshipId)
await state(() => window.__loopview.getState().toggleTheme())
await state(() => window.__loopview.getState().toggleDock())
await at(17.5)
await shot('screenshot-dark')
await state(() => window.__loopview.getState().toggleDock())
await state(() => window.__loopview.getState().toggleTheme())

await browser.close()
