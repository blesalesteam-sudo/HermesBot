import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { Embed } from './Embed'

declare const __DEMO__: boolean

const embedded = !__DEMO__ && location.pathname === '/embed'

// La app instalable y los avisos necesitan este pequeño ayudante del navegador.
if (!__DEMO__ && !embedded && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {embedded ? <Embed /> : <App />}
  </StrictMode>
)
