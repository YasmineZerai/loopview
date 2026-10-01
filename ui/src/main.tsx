import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled, not loaded from a CDN: loopview is local-first.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@xyflow/react/dist/style.css'
import './index.css'
import App from './App.tsx'
import { useStore } from './store'

// Lets dev tooling (scripts/record-demo.mjs) drive replay time precisely.
;(window as unknown as { __loopview: typeof useStore }).__loopview = useStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
