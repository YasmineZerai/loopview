// Dev-only: render docs/social-preview.png (1280x640), the image GitHub shows
// when the repository link is shared. Upload it in Settings -> Social preview.
// Usage (from ui/):  node scripts/social-preview.mjs
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const docs = new URL('../../docs/', import.meta.url)
const screenshot = (await readFile(new URL('screenshot-graph.png', docs))).toString('base64')
const logo = (await readFile(new URL('logo.svg', docs))).toString('base64')

const html = `<!doctype html><html><head><style>
  body { margin: 0; width: 1280px; height: 640px; overflow: hidden;
         font-family: 'Segoe UI', Inter, system-ui, sans-serif;
         background: radial-gradient(circle at 20% 20%, #eef2ff, #f6f6f7 55%); color: #18181b; }
  .dots { position: absolute; inset: 0; background-image: radial-gradient(#d4d4d8 1px, transparent 1px); background-size: 22px 22px; opacity: .6; }
  .text { position: absolute; left: 72px; top: 150px; width: 430px; }
  .brand { display: flex; align-items: center; gap: 14px; font-size: 54px; font-weight: 700; letter-spacing: -1.5px; }
  .brand img { width: 64px; height: 64px; }
  p { font-size: 27px; line-height: 1.35; color: #3f3f46; margin: 26px 0 0; }
  .tags { margin-top: 30px; display: flex; gap: 10px; flex-wrap: wrap; }
  .tags span { font: 15px Consolas, monospace; padding: 6px 12px; border: 1px solid #e4e4e7; border-radius: 999px; background: #fff; color: #52525b; }
  .shot { position: absolute; left: 545px; top: 70px; width: 820px; border-radius: 14px; border: 1px solid #e4e4e7;
          box-shadow: 0 30px 80px rgba(24,24,27,.18); }
</style></head><body>
  <div class="dots"></div>
  <div class="text">
    <div class="brand"><img src="data:image/svg+xml;base64,${logo}">loopview</div>
    <p>Debug your AI agents as a live graph. One view for every framework.</p>
    <div class="tags"><span>LangGraph</span><span>Pydantic AI</span><span>CrewAI</span><span>OpenAI Agents SDK</span><span>OpenAI</span><span>Anthropic</span><span>OpenTelemetry</span></div>
  </div>
  <img class="shot" src="data:image/png;base64,${screenshot}">
</body></html>`

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } })
await page.setContent(html)
await page.waitForTimeout(400)
await page.screenshot({ path: new URL('social-preview.png', docs).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
await browser.close()
console.log('saved docs/social-preview.png')
