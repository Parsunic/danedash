export function storeGet(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}

export function storeSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
  localStorage.setItem('_lastLocalChange', String(Date.now()))
  if (key.startsWith('goals:')) {
    window.dispatchEvent(new CustomEvent('goals-changed'))
  }
  window.dispatchEvent(new CustomEvent('schedule-sync'))
}

// Write without marking a genuine user edit (_lastLocalChange) or scheduling a sync push.
// Use ONLY for automated/startup normalizations — migrations, rollovers, back-fills.
// Bumping _lastLocalChange from these would make a fresh page load look like it has
// "newer" local edits than the server, which causes the sync layer to skip the remote
// pull and overwrite good remote data with stale local data. See SyncContext.jsx.
export function storeSetSilent(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function storeDelete(key) {
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
