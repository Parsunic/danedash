// PWA service-worker registration + update subscription.
//
// vite.config.js sets injectRegister:false, so we register manually here using
// the virtual module from vite-plugin-pwa. registerType is 'prompt': a freshly
// deployed SW *waits* rather than taking over, and we expose that "waiting"
// state so the UI can offer a Refresh pill instead of reloading mid-session.
// (The auto-deploy hook ships many builds — a surprise reload would lose work.)
//
// In dev the virtual module resolves to a no-op stub (devOptions.enabled:false),
// and registerPwa() is only called from main.jsx under import.meta.env.PROD, so
// dev stays completely service-worker-free.
import { registerSW } from 'virtual:pwa-register'

let updateSW = null       // the reload fn returned by registerSW
let needRefresh = false   // true once a new SW is waiting
const listeners = new Set()

function emit() {
  for (const fn of listeners) {
    try { fn(needRefresh) } catch { /* listener errors are non-fatal */ }
  }
}

// Subscribe to "update ready" changes. Fires immediately with the current
// value (so late subscribers sync up) and returns an unsubscribe fn.
export function subscribeUpdate(fn) {
  listeners.add(fn)
  fn(needRefresh)
  return () => { listeners.delete(fn) }
}

// Apply the waiting SW: skipWaiting + reload the page onto the new version.
// Called by the "Refresh" pill.
export function applyUpdate() {
  if (updateSW) updateSW(true)
}

// Register the service worker. Idempotent — safe to call once at startup.
export function registerPwa() {
  if (updateSW) return
  updateSW = registerSW({
    onNeedRefresh() {
      needRefresh = true
      emit()
    },
    onOfflineReady() {
      // App shell cached and ready to work offline. Intentionally silent —
      // no toast/pill by design (avoids noise on every first load).
    },
  })
}
