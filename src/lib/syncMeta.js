// Sync bookkeeping: WHEN each key and each record was last changed on this device.
//
// Why this exists: the sync row is one JSON blob with one timestamp, so whichever device
// pushed last replaced everything — including the parts it had never seen. Logging a set
// on your phone while your laptop wrote a task destroyed one of them, because neither
// push knew what the other held. Recording a time per key, and per record inside the
// collection keys, lets a pull MERGE instead of overwrite: each side keeps whatever it
// changed most recently, and no edit can be destroyed by an unrelated edit elsewhere.
//
// Everything here is device-local. It is never synced, never backed up, and never
// exported (see SYNC_META_KEYS in syncKeys.js) — it describes THIS device's view, so
// importing another device's copy would corrupt conflict resolution.

import { STATIC_SYNC_KEYS, DYNAMIC_SYNC_PREFIXES, getCollection, isSyncedKey } from './syncKeys.js'

const KEY_TS = '_key_ts_v1'
const KEY_TOMBS = '_key_tombs_v1'
const ITEM_TOMBS = '_item_tombs_v1'
const KILL_SWITCH = '_sync_v2_off'

// Escape hatch. Set `localStorage._sync_v2_off = '1'` in a console to drop this device
// back to the plain overwrite path without shipping a build — the only way to rescue a
// device that somehow ends up in a bad merge state.
export function mergeDisabled() {
  try { return localStorage.getItem(KILL_SWITCH) === '1' } catch { return false }
}

function readMap(name) {
  try { return JSON.parse(localStorage.getItem(name)) || {} } catch { return {} }
}
function writeMap(name, value) {
  try { localStorage.setItem(name, JSON.stringify(value)) } catch {}
}

// ── key times ──────────────────────────────────────────────────────────────
export const getKeyTsMap = () => readMap(KEY_TS)
export const getKeyTs = (key) => getKeyTsMap()[key] || 0

export function setKeyTs(key, ts) {
  const map = readMap(KEY_TS)
  map[key] = ts
  writeMap(KEY_TS, map)
}

// ── key tombstones (whole key deleted) ─────────────────────────────────────
export const getKeyTombs = () => readMap(KEY_TOMBS)

export function addKeyTomb(key, ts) {
  const tombs = readMap(KEY_TOMBS)
  tombs[key] = ts
  writeMap(KEY_TOMBS, tombs)
  const times = readMap(KEY_TS)
  if (key in times) { delete times[key]; writeMap(KEY_TS, times) }
}

export function clearKeyTomb(key) {
  const tombs = readMap(KEY_TOMBS)
  if (key in tombs) { delete tombs[key]; writeMap(KEY_TOMBS, tombs) }
}

// ── item tombstones (record removed from a collection key) ─────────────────
export const getItemTombs = () => readMap(ITEM_TOMBS)

export function addItemTombs(key, itemIds, ts) {
  if (!itemIds.length) return
  const all = readMap(ITEM_TOMBS)
  const forKey = all[key] || {}
  itemIds.forEach(id => { forKey[id] = ts })
  all[key] = forKey
  writeMap(ITEM_TOMBS, all)
}

function clearItemTombs(key, itemIds) {
  if (!itemIds.length) return
  const all = readMap(ITEM_TOMBS)
  const forKey = all[key]
  if (!forKey) return
  let changed = false
  itemIds.forEach(id => { if (id in forKey) { delete forKey[id]; changed = true } })
  if (!changed) return
  if (Object.keys(forKey).length) all[key] = forKey
  else delete all[key]
  writeMap(ITEM_TOMBS, all)
}

// ── item identity + comparison ─────────────────────────────────────────────
export function itemId(item, desc) {
  if (!item || typeof item !== 'object') return null
  const raw = item[desc.idField]
  if (raw === undefined || raw === null || raw === '') return null
  const id = String(raw)
  return desc.ci ? id.toLowerCase() : id
}

// Content equality ignoring the bookkeeping field, so re-saving an untouched record does
// not make it look newer than the other device's genuinely newer copy.
function sameContent(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const strip = (o) => {
    if (!('_ts' in o)) return o
    const { _ts, ...rest } = o
    return rest
  }
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

// Read the array a collection key holds — directly, or from inside its envelope.
function listOf(value, desc) {
  const list = desc.path ? value?.[desc.path] : value
  return Array.isArray(list) ? list : null
}
function withList(value, desc, list) {
  return desc.path ? { ...(value || {}), [desc.path]: list } : list
}

// Every record must be identifiable for record-level merging to be safe. An older build
// still running on another device can write rows with no id at any time, so this is
// checked on every write rather than assumed after the boot back-fill.
function fullyIdentified(list, desc) {
  return list.every(item => itemId(item, desc) !== null)
}

// ---------------------------------------------------------------------------
// Ranks: how a hand-arranged order survives merging.
//
// Position in an array cannot be merged — two devices each inserting a task would each
// put it at "index 3" and disagree forever. A rank can: it is a value attached to the
// record, so it merges by exactly the same rule as any other field.
//
// Callers already write the whole list in the order they want, so the order they wrote IS
// the instruction. Records whose rank no longer matches their position get a new rank
// midway between their neighbours — which is precisely the set of records a drag moved.
// Ticking a checkbox moves nothing, so it disturbs no ranks.
// ---------------------------------------------------------------------------
function assignRanks(list) {
  const out = list.map(item => ({ ...item }))
  let prev = 0
  let exhausted = false

  for (let i = 0; i < out.length; i++) {
    const cur = out[i]._r
    if (typeof cur === 'number' && Number.isFinite(cur) && cur > prev) { prev = cur; continue }

    let nextRank = null
    for (let j = i + 1; j < out.length; j++) {
      const r = out[j]._r
      if (typeof r === 'number' && Number.isFinite(r) && r > prev) { nextRank = r; break }
    }
    const rank = nextRank === null ? prev + 1 : (prev + nextRank) / 2
    // Floating point runs out of room after enough repeated splits of one gap.
    if (rank <= prev || rank === nextRank) { exhausted = true; break }
    out[i]._r = rank
    prev = rank
  }

  // Renumber from scratch rather than let ranks collide.
  if (exhausted) out.forEach((item, i) => { item._r = i + 1 })
  return out
}

// ---------------------------------------------------------------------------
// Stamp a value on its way into localStorage.
//
// Records that are new or actually changed get `_ts = now`; untouched records keep the
// time they already had, so a whole-array rewrite (which is how every caller writes)
// only claims authority over what the user really edited. Records that disappeared are
// remembered as tombstones so the removal can propagate instead of being re-added by the
// other device on the next pull.
//
// Returns the value to store — unchanged for non-collection keys.
// ---------------------------------------------------------------------------
export function stampWrite(key, value, { bumpKeyTs = true, now = Date.now() } = {}) {
  if (mergeDisabled() || !isSyncedKey(key)) return value

  clearKeyTomb(key) // re-creating a deleted key un-deletes it
  if (bumpKeyTs) setKeyTs(key, now)

  const desc = getCollection(key)
  if (!desc) return value

  const nextList = listOf(value, desc)
  if (!nextList || !fullyIdentified(nextList, desc)) return value

  let prevValue = null
  try { prevValue = JSON.parse(localStorage.getItem(key)) } catch {}
  const prevList = listOf(prevValue, desc) || []

  // Baseline for records that predate stamping: the key's own last-change time, not
  // "now". Treating pre-existing records as brand new would let a device that merely
  // opened the app outrank another device's genuinely newer edits.
  const baseline = getKeyTs(key) || now

  const prevById = new Map()
  prevList.forEach(item => {
    const id = itemId(item, desc)
    if (id !== null) prevById.set(id, item)
  })

  const seen = new Set()
  const stamped = nextList.map(item => {
    const id = itemId(item, desc)
    seen.add(id)
    const prev = prevById.get(id)
    if (prev && sameContent(prev, item)) {
      return { ...item, _ts: prev._ts || baseline }
    }
    return { ...item, _ts: now }
  })

  // Only record removals when the previous list was itself fully identified. During the
  // id back-fill the old rows have no id, so "everything vanished and reappeared" is an
  // artifact of the migration, not a deletion.
  if (prevList.length && fullyIdentified(prevList, desc)) {
    const removed = [...prevById.keys()].filter(id => !seen.has(id))
    addItemTombs(key, removed, now)
  }
  clearItemTombs(key, [...seen]) // a record that came back is no longer deleted

  return withList(value, desc, stamped)
}

// ---------------------------------------------------------------------------
// Travelling form of this device's bookkeeping.
//
// It rides as ONE reserved entry inside the existing flat payload rather than changing
// the payload's shape. That matters because the app is an installable PWA: a phone can
// still be running a build from days ago, and that build applies the payload by writing
// every entry straight into localStorage. A restructured payload would make it write
// garbage and render an empty app — and then push that emptiness back over everyone.
// With this layout, an old build writes every real key correctly and one ignorable extra.
//
// An old build also drops this entry when it pushes (it only collects known keys), which
// is exactly how a newer build detects "an older device wrote this row" — see mergeRemote.
// ---------------------------------------------------------------------------
export const META_FIELD = '__meta_v2'

export function buildSyncMeta() {
  return {
    w: 2,
    keyTs: getKeyTsMap(),
    keyTombs: getKeyTombs(),
    itemTombs: getItemTombs(),
  }
}

// ---------------------------------------------------------------------------
// One-time seeding, before any feature module reads or writes.
//
// Gives every key already on this device a starting time derived from the old global
// edit marker, so the first merge weighs this device by when it was genuinely last used.
// Keys the device does not have are deliberately left unseeded (absent = 0 = the other
// device's copy wins), so a fresh or long-idle browser never claims authority over data
// it has never seen.
// ---------------------------------------------------------------------------
export function initSyncMeta() {
  if (mergeDisabled()) return
  try {
    if (localStorage.getItem(KEY_TS) !== null) return
  } catch { return }

  const legacy = parseInt(localStorage.getItem('_lastLocalChange') || '0') || 0
  const seed = Math.min(legacy || Date.now(), Date.now())

  const map = {}
  STATIC_SYNC_KEYS.forEach(k => {
    if (localStorage.getItem(k) !== null) map[k] = seed
  })
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && DYNAMIC_SYNC_PREFIXES.some(p => k.startsWith(p))) map[k] = seed
  }
  writeMap(KEY_TS, map)
}
