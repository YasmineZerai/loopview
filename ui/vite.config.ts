/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Python server serves the built UI, so the normal build goes straight into
// the package. `--mode pages` builds the hosted demo instead: a static site
// (relative paths, so it works under any sub-path such as GitHub Pages'
// /loopview/) that reads recorded runs from pages-public/demo.
const SERVER_STATIC_DIR = '../server/src/loopview/static'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
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
