import { stampWrite, addKeyTomb } from './syncMeta.js'

export function storeGet(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}

// A genuine user edit: records WHEN it happened (per key, and per record for the keys
// that hold lists) and schedules a push. The timing data is what lets a pull from
// another device merge with this one instead of overwriting it — see syncMeta.js.
export function storeSet(key, value) {
  localStorage.setItem(key, JSON.stringify(stampWrite(key, value)))
  localStorage.setItem('_lastLocalChange', String(Date.now()))
  if (key.startsWith('goals:')) {
    window.dispatchEvent(new CustomEvent('goals-changed'))
  }
  window.dispatchEvent(new CustomEvent('schedule-sync'))
}

// Write without claiming that the USER just edited: no push, and no bump of the key's
// change time. Use ONLY for automated/startup normalizations — migrations, rollovers,
// back-fills, device-local caches.
//
// Records inside collection keys ARE still versioned, because a migration that rewrites
// stored records must not be silently reverted by another device's older copy — which
// would make it re-run and revert on every load, forever.
export function storeSetSilent(key, value) {
  localStorage.setItem(key, JSON.stringify(stampWrite(key, value, { bumpKeyTs: false })))
}

// A genuine user deletion. Records a tombstone so the removal propagates; without one,
// the other device still holds the key and pushes it straight back.
export function storeDelete(key) {
  const existed = localStorage.getItem(key) !== null
  localStorage.removeItem(key)
  if (!existed) return
  addKeyTomb(key, Date.now())
  localStorage.setItem('_lastLocalChange', String(Date.now()))
  if (key.startsWith('goals:')) {
    window.dispatchEvent(new CustomEvent('goals-changed'))
  }
  window.dispatchEvent(new CustomEvent('schedule-sync'))
}

// Delete without recording a tombstone — the key disappears on THIS device only.
// Use for automated/startup pruning (doRollover retiring past `goals:` keys) and for
// device-local keys. A tombstoning delete there would propagate the pruning to every
// device and wipe shared history.
export function storeDeleteSilent(key) {
  localStorage.removeItem(key)
}

export function storeListKeys(prefix) {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(prefix)) keys.push(k)
  }
  return keys
}
