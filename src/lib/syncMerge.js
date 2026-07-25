// Merging remote data into local data, instead of overwriting it.
//
// The old behaviour was: whichever device pushed last replaced the entire blob. Its push
// carried its own stale copy of everything it had not touched, so an edit made on the
// other device in the same few seconds was destroyed — and the realtime echo then made
// the first device delete its own work from its own screen.
//
// Merging fixes that by asking a narrower question. Not "which device is newer?" but
// "which device last changed THIS key, and THIS record?". Each side keeps whatever it
// genuinely changed most recently, so two devices editing different things can never
// destroy each other, no matter how close together the edits land.
//
// The functions here are pure — they take values and times and return values. The
// localStorage plumbing lives in applyRemote() at the bottom.

import { getCollection } from './syncKeys.js'
import { META_FIELD, itemId, getKeyTs, setKeyTs, getKeyTombs, getItemTombs } from './syncMeta.js'

// A record's own time, falling back to its key's time for records written before
// stamping existed.
const recordTs = (item, fallback) => (item && item._ts) || fallback

// ---------------------------------------------------------------------------
// Merge two versions of a list key.
//
// Union by identity: a record present on one side only is kept, a record on both sides
// resolves to whichever copy was changed later. Deleted records are dropped only when
// the deletion is NEWER than the surviving copy — so deleting on one device while
// editing on the other keeps the edit rather than silently losing it.
//
// Order follows the local list, with records only the other side has appended. Ordering
// is handled properly by ranks in a later pass; until then, never reordering what the
// user is looking at is the least surprising behaviour.
// ---------------------------------------------------------------------------
export function mergeLists(localList, remoteList, desc, localTs, remoteTs, tombs = {}) {
  const remoteById = new Map()
  remoteList.forEach(item => {
    const id = itemId(item, desc)
    if (id !== null) remoteById.set(id, item)
  })

  const dropped = (id, item, ts) => {
    const tombTs = tombs[id]
    return tombTs !== undefined && tombTs > recordTs(item, ts)
  }

  const out = []
  const seen = new Set()

  localList.forEach(local => {
    const id = itemId(local, desc)
    if (id === null) { out.push(local); return }
    seen.add(id)
    const remote = remoteById.get(id)
    if (!remote) {
      if (!dropped(id, local, localTs)) out.push(local)
      return
    }
    const lTs = recordTs(local, localTs)
    const rTs = recordTs(remote, remoteTs)
    const winner = rTs > lTs ? remote : local
    if (!dropped(id, winner, Math.max(lTs, rTs))) out.push(winner)
  })

  remoteList.forEach(remote => {
    const id = itemId(remote, desc)
    if (id === null) return // unidentifiable and not ours — cannot place it safely
    if (seen.has(id)) return
    if (!dropped(id, remote, remoteTs)) out.push(remote)
  })

  return out
}

// A list key can wrap its records in an envelope (body_metrics_v1 is `{v:1, entries:[…]}`).
const listOf = (value, desc) => {
  const list = desc.path ? value?.[desc.path] : value
  return Array.isArray(list) ? list : null
}
const withList = (value, desc, list) =>
  (desc.path ? { ...(value || {}), [desc.path]: list } : list)

// Record-level merging is only safe when every record can be named. An older build still
// running elsewhere can write rows with no id at any time, so this is checked rather than
// assumed — when it fails the key falls back to whole-key resolution, which is exactly
// the old behaviour and never worse than it.
const identifiable = (list, desc) => list.every(item => itemId(item, desc) !== null)

// ---------------------------------------------------------------------------
// Merge one key. Returns the value to store, or NO_CHANGE to leave local alone.
// ---------------------------------------------------------------------------
export const NO_CHANGE = Symbol('no-change')

export function mergeValue(key, localValue, remoteValue, localTs, remoteTs, itemTombs = {}) {
  const hasLocal = localValue !== undefined
  if (!hasLocal) return remoteValue

  const desc = getCollection(key)
  if (desc) {
    const localList = listOf(localValue, desc)
    const remoteList = listOf(remoteValue, desc)
    if (localList && remoteList && identifiable(localList, desc) && identifiable(remoteList, desc)) {
      const merged = mergeLists(localList, remoteList, desc, localTs, remoteTs, itemTombs)
      return withList(remoteTs > localTs ? remoteValue : localValue, desc, merged)
    }
  }

  // Whole-key resolution: settings blobs, single values, or a list we cannot merge safely.
  return remoteTs > localTs ? remoteValue : NO_CHANGE
}

// ---------------------------------------------------------------------------
// Apply a remote payload to localStorage by merging.
//
// Returns { applied, needsPush }:
//   applied  — local data changed, so feature modules must re-read
//   needsPush — the merged result differs from what the server holds, so the other
//               device is missing something and we owe it a push. This is what stops a
//               disagreement from sitting there unresolved.
// ---------------------------------------------------------------------------
export function applyRemote(payload, remoteMs, { allowTombstones = true } = {}) {
  if (!payload) return { applied: false, needsPush: false }

  const meta = payload[META_FIELD]
  // A payload with no bookkeeping was written by an older build. It cannot express
  // WHEN anything changed, so its whole row is dated at the row's own timestamp — and
  // its deletions, which it cannot express either, are not held against it: applying our
  // tombstones to it could delete records that device legitimately still has.
  const legacy = !meta || meta.w !== 2
  const remoteKeyTs = legacy ? null : (meta.keyTs || {})
  const remoteKeyTombs = legacy ? {} : (meta.keyTombs || {})
  const remoteItemTombs = legacy ? {} : (meta.itemTombs || {})
  const useTombs = allowTombstones && !legacy

  const localKeyTombs = useTombs ? getKeyTombs() : {}
  const localItemTombs = useTombs ? getItemTombs() : {}

  let applied = false
  let needsPush = false

  const remoteTsFor = (key) => (legacy ? remoteMs : (remoteKeyTs[key] ?? remoteMs))

  const readLocal = (key) => {
    const raw = localStorage.getItem(key)
    if (raw === null) return undefined
    try { return JSON.parse(raw) } catch { return undefined }
  }

  const remoteKeys = Object.keys(payload).filter(k => k !== META_FIELD)

  remoteKeys.forEach(key => {
    const remoteValue = payload[key]
    const remoteTs = remoteTsFor(key)
    const localTs = getKeyTs(key)
    const localValue = readLocal(key)

    // We deleted this key and the server has not caught up yet.
    if (useTombs) {
      const tomb = localKeyTombs[key]
      if (tomb !== undefined && tomb > remoteTs) { needsPush = true; return }
    }

    const tombsForKey = useTombs
      ? { ...(localItemTombs[key] || {}), ...(remoteItemTombs[key] || {}) }
      : {}

    const next = mergeValue(key, localValue, remoteValue, localTs, remoteTs, tombsForKey)
    if (next !== NO_CHANGE && JSON.stringify(next) !== JSON.stringify(localValue)) {
      localStorage.setItem(key, JSON.stringify(next))
      applied = true
    }
    // The stored content now reflects both sides, so the key's recorded time has to say
    // so. Leaving it at the older value would advertise fresh content as stale and let a
    // third device's out-of-date copy win the next comparison.
    setKeyTs(key, Math.max(localTs, remoteTs))

    // Whatever we ended up with, if it isn't what the server sent, the server is stale.
    const settled = next === NO_CHANGE ? localValue : next
    if (JSON.stringify(settled) !== JSON.stringify(remoteValue)) needsPush = true
  })

  // Keys the server still holds that we deleted.
  if (useTombs) {
    Object.entries(remoteKeyTombs).forEach(([key, tomb]) => {
      if (tomb > getKeyTs(key) && localStorage.getItem(key) !== null) {
        localStorage.removeItem(key)
        applied = true
      }
    })
  }

  // Anything we hold that the server has never seen has to go up, or it lives on exactly
  // one device forever.
  if (!needsPush) {
    const remoteSet = new Set(remoteKeys)
    needsPush = Object.keys(getKeyTsMap())
      .some(key => !remoteSet.has(key) && localStorage.getItem(key) !== null)
  }

  return { applied, needsPush }
}
