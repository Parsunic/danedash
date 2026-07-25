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

import { getCollection, getMapMerge } from './syncKeys.js'
import { META_FIELD, itemId, getKeyTs, setKeyTs, getKeyTsMap, getKeyTombs, getItemTombs } from './syncMeta.js'

// A record's own time, falling back to its key's time for records written before
// stamping existed.
const recordTs = (item, fallback) => (item && item._ts) || fallback

// Two edits can land in the same millisecond, and two devices can hold copies that are
// equally old. "Keep whatever is local" looks harmless but leaves each device preferring
// its own copy forever — they would never agree. Breaking the tie by comparing the values
// themselves is arbitrary, but it is the SAME arbitrary answer on both devices, which is
// the only property that matters.
function breakTie(a, b) {
  const sa = canonical(a)
  const sb = canonical(b)
  return sa >= sb ? a : b
}

// Compare by MEANING, not by byte order.
//
// Merging two objects produces the same entries in different orders depending on which
// device did the merging, and plain JSON.stringify would call those different. That is
// not a harmless inaccuracy: it makes each device think the other is missing something,
// so they push at each other forever.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
}

// ---------------------------------------------------------------------------
// Merge two versions of a list key.
//
// Union by identity: a record present on one side only is kept, a record on both sides
// resolves to whichever copy was changed later. Deleted records are dropped only when
// the deletion is NEWER than the surviving copy — so deleting on one device while
// editing on the other keeps the edit rather than silently losing it.
//
// Order: hand-arranged lists carry a rank per record, so the merged list is sorted by it
// and both devices land on the same arrangement. Lists whose order is not a user decision
// keep the local order with the other side's records appended — their views sort by date
// anyway, so imposing an order here would only churn.
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
    let winner = rTs > lTs ? remote : (lTs > rTs ? local : breakTie(local, remote))

    // Resolve WHERE separately from WHAT. A record edited on one device while being
    // dragged on the other should keep both the edit and the new position.
    if (desc.ordered) {
      const lr = local._rts || lTs
      const rr = remote._rts || rTs
      const pos = rr > lr ? remote : (lr > rr ? local : breakTie(local, remote))
      if (pos !== winner) winner = { ...winner, _r: pos._r, _rts: pos._rts }
    }
    if (!dropped(id, winner, Math.max(lTs, rTs))) out.push(winner)
  })

  remoteList.forEach(remote => {
    const id = itemId(remote, desc)
    if (id === null) return // unidentifiable and not ours — cannot place it safely
    if (seen.has(id)) return
    if (!dropped(id, remote, remoteTs)) out.push(remote)
  })

  if (!desc.ordered) return out

  // Sort by rank so a hand-arranged order survives; records with no rank yet keep their
  // current position by falling back to it, and identical ranks resolve by id so the
  // result cannot depend on which device is doing the merging.
  return out
    .map((item, i) => ({ item, i, r: typeof item._r === 'number' ? item._r : i + 1 }))
    .sort((a, b) => (a.r - b.r) || String(a.item.id).localeCompare(String(b.item.id)))
    .map(x => x.item)
}

// A list key can wrap its records in an envelope (body_metrics_v1 is `{v:1, entries:[…]}`).
const listOf = (value, desc) => {
  const list = desc.path ? value?.[desc.path] : value
  return Array.isArray(list) ? list : null
}
const withList = (value, desc, list) =>
  (desc.path ? { ...(value || {}), [desc.path]: list } : list)

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// ---------------------------------------------------------------------------
// Merge two versions of a map key, entry by entry.
//
// An entry only one side has is kept. An entry both sides have is recursed into while
// depth remains, then resolved as a whole by which side changed the key more recently.
// So ticking habit X here and habit Y there keeps both, while ticking the SAME habit in
// both places settles on the later one — including un-ticking it, which a plain union
// could never express.
// ---------------------------------------------------------------------------
export function mergeMaps(localValue, remoteValue, depth, localTs, remoteTs) {
  if (!isPlainObject(localValue) || !isPlainObject(remoteValue)) {
    return remoteTs > localTs ? remoteValue
      : (localTs > remoteTs ? localValue : breakTie(localValue, remoteValue))
  }
  const out = { ...localValue }
  Object.keys(remoteValue).forEach(field => {
    const l = localValue[field]
    const r = remoteValue[field]
    if (!(field in localValue)) { out[field] = r; return }
    if (depth > 1 && isPlainObject(l) && isPlainObject(r)) {
      out[field] = mergeMaps(l, r, depth - 1, localTs, remoteTs)
      return
    }
    if (canonical(l) === canonical(r)) return
    out[field] = remoteTs > localTs ? r : (localTs > remoteTs ? l : breakTie(l, r))
  })
  return out
}

// Exercise history is `{ "Bench Press": { allTimePR, sessions:[…] } }` — facts about
// workouts that already happened, so the two sides can be combined outright rather than
// one being chosen. Resolving it by recency would throw away a workout logged on the
// other device, which is exactly the complaint.
export function mergeExerciseHistory(localValue, remoteValue) {
  if (!isPlainObject(localValue) || !isPlainObject(remoteValue)) return remoteValue
  const out = { ...localValue }
  Object.keys(remoteValue).forEach(name => {
    const l = localValue[name]
    const r = remoteValue[name]
    if (!l) { out[name] = r; return }
    if (!r) return

    const seen = new Set()
    const sessions = []
    ;[...(l.sessions || []), ...(r.sessions || [])].forEach(s => {
      // A session edit can change its date, so identity is the whole set of numbers.
      const sig = `${s.date}|${s.weight}|${s.reps}|${s.rpe}|${s.e1rm}`
      if (seen.has(sig)) return
      seen.add(sig)
      sessions.push(s)
    })
    sessions.sort((a, b) => String(a.date).localeCompare(String(b.date)))

    out[name] = {
      ...l, ...r,
      allTimePR: Math.max(l.allTimePR || 0, r.allTimePR || 0),
      sessions: sessions.slice(-20), // same cap the writer applies
    }
  })
  return out
}

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

  const mapDesc = getMapMerge(key)
  if (mapDesc) {
    if (mapDesc.merge === 'exerciseHistory') return mergeExerciseHistory(localValue, remoteValue)
    return mergeMaps(localValue, remoteValue, mapDesc.depth || 1, localTs, remoteTs)
  }

  // Whole-key resolution: settings blobs, single values, or a list we cannot merge safely.
  if (remoteTs > localTs) return remoteValue
  if (localTs > remoteTs) return NO_CHANGE
  return breakTie(localValue, remoteValue)
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
  // A row written by an older build has lost all the bookkeeping. Push unconditionally to
  // put it back, otherwise every later merge keeps guessing at times it could have known.
  let needsPush = legacy

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
