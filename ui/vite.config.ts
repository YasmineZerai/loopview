/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The Python server serves the built UI, so the normal build goes straight into
// the package. `--mode pages` builds the hosted demo instead: a static site
// (relative paths, so it works under any sub-path such as GitHub Pages'
// /loopview/) that reads recorded runs from pages-public/demo.
const SERVER_STATIC_DIR = '../server/src/loopview/static'

// The hosted demo's link preview (LinkedIn, Slack, X...). Only the demo has a public
// address to point at; the image is copied next to it by the Pages workflow.
const DEMO_URL = 'https://yasminezerai.github.io/loopview/'
const DEMO_TITLE = 'loopview: debug your AI agents as a live graph'
const DEMO_DESCRIPTION =
  "See which agent ran, which tool failed, what it did next and what it cost, whatever framework it's built with. Recorded runs, nothing to install."

function linkPreview(): Plugin {
  const tags: Record<string, string> = {
    'og:type': 'website',
    'og:site_name': 'loopview',
    'og:title': DEMO_TITLE,
    'og:description': DEMO_DESCRIPTION,
    'og:url': DEMO_URL,
    'og:image': `${DEMO_URL}social-preview.png`,
    'og:image:width': '1280',
    'og:image:height': '640',
    'og:image:alt': 'loopview: a multi-agent run drawn as a live graph',
  }
  return {
    name: 'link-preview',
    // At the end of <head>, so <meta charset> stays within the page's first bytes.
    transformIndexHtml: () =>
      [
        { tag: 'meta', attrs: { name: 'description', content: DEMO_DESCRIPTION } },
        ...Object.entries(tags).map(([property, content]) => ({ tag: 'meta', attrs: { property, content } })),
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ].map((t) => ({ ...t, injectTo: 'head' as const })),
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'pages' ? [linkPreview()] : [])],
  base: mode === 'pages' ? './' : '/',
  publicDir: mode === 'pages' ? 'pages-public' : false,
  build: {
    outDir: mode === 'pages' ? 'dist-pages' : SERVER_STATIC_DIR,
    emptyOutDir: true,
  },
  server: {
    // In development, `npm run dev` serves the UI with hot reload and forwards
    // API and OTLP calls to a running `loopview` server.
    proxy: {
      '/api': 'http://127.0.0.1:4318',
      '/v1': 'http://127.0.0.1:4318',
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}))
