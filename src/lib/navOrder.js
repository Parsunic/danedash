import { useState, useEffect } from 'react'
import { storeGet, storeSet } from './storage.js'
import { modules } from '../App.jsx'

export const NAV_ORDER_KEY = 'nav_order_v1'

// Pure, tolerant reconciler. NEVER writes storage.
// stored: whatever came out of localStorage (possibly null / malformed).
// allModules: the static App.jsx `modules` array (source of truth for valid paths + default order).
// Returns { order: [paths], hidden: [paths] } that is always internally consistent:
//   - order contains every module path exactly once, in a valid order
//   - hidden ⊆ order, never contains '/', >= 2 modules stay visible on mobile
export function resolveNavOrder(stored, allModules) {
  const allPaths = allModules.map(m => m.path)
  const allSet = new Set(allPaths)

  // ── order ── keep stored paths that still exist (deduped), then append any
  // modules the stored order never mentioned, in their App.jsx order.
  const rawOrder = stored && Array.isArray(stored.order) ? stored.order : []
  const order = []
  const seen = new Set()
  for (const p of rawOrder) {
    if (allSet.has(p) && !seen.has(p)) { order.push(p); seen.add(p) }
  }
  for (const p of allPaths) {
    if (!seen.has(p)) { order.push(p); seen.add(p) }
  }

  // ── hidden ── strip '/', drop anything not present in order, dedupe.
  const rawHidden = stored && Array.isArray(stored.hidden) ? stored.hidden : []
  const orderSet = new Set(order)
  let hidden = []
  const hiddenSeen = new Set()
  for (const p of rawHidden) {
    if (p === '/' || !orderSet.has(p) || hiddenSeen.has(p)) continue
    hidden.push(p); hiddenSeen.add(p)
  }

  // ── enforce >= 2 visible on mobile ── un-hide from the end of `order` until satisfied.
  if (order.length >= 2) {
    for (let i = order.length - 1; i >= 0 && (order.length - hidden.length) < 2; i--) {
      const idx = hidden.indexOf(order[i])
      if (idx !== -1) hidden.splice(idx, 1)
    }
  }

  return { order, hidden }
}

// Persist a reconciled nav order. USER GESTURE ONLY (Settings Save path) —
// storeSet stamps _lastLocalChange and schedules a Supabase push.
export function saveNavOrder({ order, hidden }) {
  storeSet(NAV_ORDER_KEY, { order, hidden })
  window.dispatchEvent(new Event('nav-changed'))
}

// Hook: resolves the stored nav order against the static module list and keeps
// it live across 'nav-changed' (local Save) and 'sync-applied' (remote pull).
// ordered      = all modules in stored order (sidebar shows every module)
// mobileVisible = ordered minus hidden (bottom bar + swipe)
export function useNavModules() {
  const [state, setState] = useState(() => resolveNavOrder(storeGet(NAV_ORDER_KEY), modules))

  useEffect(() => {
    const reresolve = () => {
      const next = resolveNavOrder(storeGet(NAV_ORDER_KEY), modules)
      setState(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    window.addEventListener('nav-changed', reresolve)
    window.addEventListener('sync-applied', reresolve)
    return () => {
      window.removeEventListener('nav-changed', reresolve)
      window.removeEventListener('sync-applied', reresolve)
    }
  }, [])

  const ordered = state.order.map(p => modules.find(m => m.path === p)).filter(Boolean)
  const hiddenSet = new Set(state.hidden)
  const mobileVisible = ordered.filter(m => !hiddenSet.has(m.path))
  return { ordered, mobileVisible }
}
