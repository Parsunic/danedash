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
