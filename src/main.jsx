import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/globals.css'
import { backfillItemIds, doRollover, injectRecurringTasks } from './lib/init.js'
import { initSyncMeta } from './lib/syncMeta.js'
import { registerPwa } from './lib/pwa.js'
import { startNotificationLoop } from './lib/notifications.js'

// Order matters. Sync bookkeeping is seeded first so the writes below are measured
// against this device's real last-use time rather than looking brand new; then every
// task row gets an `id`, because record-level merging tracks tasks by id and rollover is
// about to read and rewrite those lists.
initSyncMeta()
backfillItemIds()
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

// Local reminders loop (B9). Safe/write-free to start unconditionally — it no-ops
// until the user enables notifications in Settings and grants permission. Module-
// scope guarded against StrictMode double-invocation.
startNotificationLoop()
