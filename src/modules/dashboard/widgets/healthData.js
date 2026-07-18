import { fetchHealthHistory } from '../../health/googleFitSync.js'

// Shared dashboard health-data cache (extracted from SleepWidget so every
// health-reading dashboard widget shares ONE fetch).
//
// fetchHealthHistory() hits Supabase, so a module-scope cache guards it: rows
// are reused for 15 minutes and concurrent callers (React.StrictMode
// double-mount, remounts across sizes, multiple widgets on one dashboard)
// share one in-flight promise — never a double request. Fetches 30 days:
// SleepWidget windows down to its last-7-days view, ReadinessWidget needs the
// full 30 for HRV/RHR baselines. A completed Google Health sync
// ('gfit-sync-status' → 'synced') should invalidate via invalidateHealthCache()
// so fresh data appears without a reload. Read-only, no mutation.

const TTL = 15 * 60 * 1000
const DAYS = 30
let cache = { ts: 0, rows: null, promise: null }

export function getHealthRows() {
  const now = Date.now()
  if (cache.rows && now - cache.ts < TTL) return Promise.resolve(cache.rows)
  if (cache.promise) return cache.promise
  cache.promise = fetchHealthHistory(DAYS)
    .then(rows => {
      cache.rows = Array.isArray(rows) ? rows : []
      cache.ts = Date.now()
      cache.promise = null
      return cache.rows
    })
    .catch(() => {
      cache.promise = null
      return cache.rows || []
    })
  return cache.promise
}

// Synchronous peek for initial widget state (null until first fetch resolves).
export function peekHealthRows() {
  return cache.rows
}

export function invalidateHealthCache() {
  cache.ts = 0
}
