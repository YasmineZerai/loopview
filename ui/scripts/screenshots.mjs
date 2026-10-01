// Dev-only visual review: capture the UI in several states with a headless browser.
//
// Usage: start a fresh server (`uv run loopview --port 4400 --no-browser` in server/),
// then from ui/:  node scripts/screenshots.mjs http://127.0.0.1:4400 <out-dir>
//
// Uses the Edge or Chrome already installed on the machine (channel), so no
// browser download is needed.

import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:4400'
const out = process.argv[3] ?? 'screenshots'
const fixtures = new URL('../../fixtures/', import.meta.url)

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 })
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` })
  console.log(`saved ${out}/${name}.png`)
}
const importFixture = async (name) => {
  const body = await readFile(new URL(`${name}.otlp.jsonl`, fixtures))
  const r = await fetch(`${base}/api/import`, { method: 'POST', body })
  return (await r.json()).trace_ids[0]
}
const openRun = async (name) => {
  await page.getByRole('button', { name: new RegExp(name) }).first().click()
  await page.waitForTimeout(1200)
}

// 1. Empty state: nothing received yet.
await page.goto(base)
await page.waitForTimeout(800)
await shot('01-empty')

// 2. The demo, final state, loaded from the empty state's button.
await page.getByRole('button', { name: /Load the demo run/ }).click()
await page.waitForTimeout(1800)
await shot('02-demo-final')

// 3. Replaying the demo: parallel workers running, then the critic loop.
await page.keyboard.press('Space')
await page.waitForTimeout(5200)
await shot('03-demo-replay-parallel')
await page.waitForTimeout(9500)
await shot('04-demo-replay-critic')
await page.keyboard.press('Space')

// 4. Details panel on the failing worker.
await page.locator('.react-flow__node-step', { hasText: 'fetch_repo_stats' }).first().click()
await page.waitForTimeout(700)
await shot('05-details-panel')
await page.keyboard.press('Escape')

// 5. The other fixtures: LangGraph loop, single agent, multi-agent.
await importFixture('langgraph_router')
await openRun('LangGraph')
await shot('06-langgraph-loop')
await importFixture('react_anthropic')
await openRun('trip_budget_agent')
await shot('07-single-agent')
await importFixture('multi_agent_pydantic')
await openRun('laptop_advice')
await shot('08-multi-agent')

await browser.close()
