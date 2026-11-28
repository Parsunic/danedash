// Browser-ish globals for running the app's sync modules under Node.
//
// Import this BEFORE any module from src/lib: those modules read `localStorage` and call
// `window.dispatchEvent` directly.
//
// Several simulated devices share one process, so `localStorage` resolves through an
// AsyncLocalStorage context: whatever device started an operation keeps its own storage
// across every await, timer and promise that operation spawns.
import { AsyncLocalStorage } from 'node:async_hooks'

export class MemoryStorage {
  constructor() { this.m = new Map() }
  get length() { return this.m.size }
  key(i) { return [...this.m.keys()][i] ?? null }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
  clear() { this.m.clear() }
}

export const als = new AsyncLocalStorage()

// Used when no device context is active — single-device unit tests.
let fallback = new MemoryStorage()
export function resetStorage() {
  fallback = new MemoryStorage()
  return fallback
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() { return als.getStore()?.ls ?? fallback },
})

globalThis.window = {
  dispatchEvent(ev) { als.getStore()?.onEvent?.(ev.type) },
  addEventListener() {},
  removeEventListener() {},
}
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class { constructor(type) { this.type = type } }
}

export const wait = (ms) => new Promise(r => setTimeout(r, ms))
