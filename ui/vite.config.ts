/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Python server serves the built UI, so the build goes straight into the package.
const SERVER_STATIC_DIR = '../server/src/loopview/static'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: SERVER_STATIC_DIR,
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
})
