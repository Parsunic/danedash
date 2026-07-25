// Data backup & restore (feature B2).
// Exports the user's app data to a downloadable JSON file and restores it on this device.
// Credentials, OAuth tokens, and device-local flags are intentionally EXCLUDED — this is
// your data, not your secrets. Restore uses silent writes for the bulk load and a single
// stamped write so the sync layer pushes the whole restored dataset up exactly once.

import { storeSet, storeSetSilent } from './storage.js'
import { STATIC_SYNC_KEYS, DYNAMIC_SYNC_PREFIXES, SYNC_META_KEYS } from './syncKeys.js'
import { claimAuthorityOver } from './syncMeta.js'

// Key coverage comes from src/lib/syncKeys.js — the same lists the sync layer uses.
// These were previously duplicated here behind a "KEEP IN SYNC" comment and had drifted:
// body_metrics_v1, weekly_reviews_v1, finance_budgets, notif_prefs_v1, overseer_config_v1
// and the finance: prefix were all missing, so backups silently omitted that data.

// Non-synced app data worth preserving in a backup (not part of cross-device sync).
const EXTRA_STATIC_KEYS = [
  'gym_active_session',  // an in-progress workout
]

// Non-synced local caches worth preserving (regenerable, but keeps the restored app
// feeling identical). Optional per the B2 spec — harmless to include.
const EXTRA_DYNAMIC_PREFIXES = [
  'goals_pulse_verdict:',  // daily AI "pulse" verdict cache
  'goals_ai_',             // goals_ai_daily:* / goals_ai_weekly:* insight caches
]

// ---------------------------------------------------------------------------
// Never-export list — credentials, secrets, device-local markers, transient flags.
// Exact secret key names verified against src/lib/api/*.js.
// ---------------------------------------------------------------------------
const EXCLUDE_EXACT = new Set([
  'anthropic_api_key',
  'notion_api_key',
  'gcal_client_id', 'gcal_client_secret',
  'gcal_access_token', 'gcal_refresh_token', 'gcal_token_expiry', 'gcal_user_email',
  'gfit_access_token', 'gfit_refresh_token', 'gfit_token_expiry', 'gfit_last_sync',
  'fitbit_client_id', 'fitbit_access_token', 'fitbit_refresh_token', 'fitbit_token_expiry', 'fitbit_last_sync',
  // Sync bookkeeping — describes THIS device's view of the data, so importing another
  // device's copy would corrupt conflict resolution.
  ...SYNC_META_KEYS,
])

// Defensive prefix guard — anything token/secret shaped is dropped even if a new key
// is added to that family later.
const EXCLUDE_PREFIXES = ['gcal_', 'gfit_', 'fitbit_']

function isExcluded(key) {
  if (EXCLUDE_EXACT.has(key)) return true
  return EXCLUDE_PREFIXES.some(p => key.startsWith(p))
}

function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ---------------------------------------------------------------------------
// Collect a backup object. Values are stored RAW (the exact localStorage string,
// no JSON.parse) for maximum fidelity.
// ---------------------------------------------------------------------------
export function collectBackup() {
  const keys = {}

  // Curated exact keys (statics + extras). Only present keys are captured.
  for (const k of [...STATIC_SYNC_KEYS, ...EXTRA_STATIC_KEYS]) {
    if (isExcluded(k)) continue
    const v = localStorage.getItem(k)
    if (v !== null) keys[k] = v
  }

  // Prefix keys: enumerate every matching localStorage entry.
  const prefixes = [...DYNAMIC_SYNC_PREFIXES, ...EXTRA_DYNAMIC_PREFIXES]
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || k in keys || isExcluded(k)) continue
    if (prefixes.some(p => k.startsWith(p))) {
      const v = localStorage.getItem(k)
      if (v !== null) keys[k] = v
    }
  }

  return {
    app: 'UltraDash',
    version: 1,
    exported_at: new Date().toISOString(),
    keys,
  }
}

// ---------------------------------------------------------------------------
// Build the backup, serialize it, and trigger a file download via a temporary anchor.
// ---------------------------------------------------------------------------
export function downloadBackup() {
  const json = JSON.stringify(collectBackup(), null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ultradash-backup-${todayStr()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so the download has a chance to start (Firefox/Safari safety).
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------------------
// Restore from the text of a backup file. Validates shape, then:
//   1. writes every key SILENTLY (storeSetSilent) — no _lastLocalChange stamp and no
//      per-key sync push, so a bulk restore does not spam the sync layer;
//   2. performs ONE stamped storeSet of a single key, so exactly one genuine local edit
//      is registered and the whole restored dataset is pushed up once on the next boot;
//   3. reloads so every module re-reads the restored data from a clean start.
// Returns { count } (keys written). Throws a friendly Error on malformed input, leaving
// existing data untouched (validation happens before any write).
// ---------------------------------------------------------------------------
export function restoreBackup(fileText) {
  let parsed
  try {
    parsed = JSON.parse(fileText)
  } catch {
    throw new Error("That file isn't valid JSON. Pick an UltraDash backup file (.json).")
  }

  const validShape =
    parsed && typeof parsed === 'object' &&
    parsed.app === 'UltraDash' && parsed.version === 1 &&
    parsed.keys && typeof parsed.keys === 'object' && !Array.isArray(parsed.keys)
  if (!validShape) {
    throw new Error("This doesn't look like an UltraDash backup (expected app “UltraDash”, version 1).")
  }

  // Snapshot which synced keys this device holds BEFORE restoring, so step 2 can tell
  // what the backup is dropping.
  const presentBefore = {}
  for (const k of STATIC_SYNC_KEYS) {
    if (localStorage.getItem(k) !== null) presentBefore[k] = true
  }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && DYNAMIC_SYNC_PREFIXES.some(p => k.startsWith(p))) presentBefore[k] = true
  }

  // 1. Bulk silent restore. Each stored value is a raw JSON string; parse it so
  //    storeSetSilent (which JSON.stringifies) round-trips it exactly instead of
  //    double-encoding. Fall back to a raw write if a value somehow isn't JSON.
  const written = []
  for (const [k, raw] of Object.entries(parsed.keys)) {
    if (typeof raw !== 'string') continue
    if (isExcluded(k)) continue // never restore secrets/flags, even if present in the file
    try {
      storeSetSilent(k, JSON.parse(raw))
    } catch {
      localStorage.setItem(k, raw)
    }
    written.push(k)
  }

  if (written.length === 0) {
    throw new Error('That backup file contained no restorable data.')
  }

  // 2. Claim the restored state as authoritative.
  //
  //    Restore is the ONE operation that must replace rather than merge. Sync normally
  //    combines both sides, which for a restore would quietly resurrect everything
  //    deleted since the backup was taken — the opposite of what restoring means. So
  //    every restored key is marked as changed now, and any synced key this device held
  //    that the backup does not contain is marked deleted, so the restored picture is
  //    what propagates rather than being merged back into what it was meant to replace.
  claimAuthorityOver(written, presentBefore)

  // 3. One stamped write so the restored dataset is pushed up exactly once.
  const anchor =
    (written.includes('gym_settings') && 'gym_settings') ||
    STATIC_SYNC_KEYS.find(k => written.includes(k)) ||
    written[0]
  const anchorRaw = parsed.keys[anchor]
  try {
    storeSet(anchor, JSON.parse(anchorRaw))
  } catch {
    storeSet(anchor, anchorRaw)
  }

  // 4. Reload so every module boots clean against the restored data.
  location.reload()

  return { count: written.length }
}
