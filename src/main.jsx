import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/globals.css'
import { doRollover, injectRecurringTasks } from './lib/init.js'
import { registerPwa } from './lib/pwa.js'

doRollover()
injectRecurringTasks()

// Register the service worker for offline support (prompt-mode updates).
// PROD only — dev stays service-worker-free.
if (import.meta.env.PROD) registerPwa()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
