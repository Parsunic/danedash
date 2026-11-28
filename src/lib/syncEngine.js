// Cross-device sync engine: moves data between this device's localStorage and the
// `app_state` rows in Supabase, merging (never overwriting) in both directions.
//
// Plain module, no React — SyncContext.jsx wires it to the page (visibility, focus, the
// `schedule-sync` event, status display). Keeping it free of the DOM is what lets the
// whole protocol be exercised against simulated devices.
//
// ── Why it is shaped like this: Supabase egress ────────────────────────────────────
// Supabase bills every byte it sends out, and the free plan allows 5 GB a month. The
// previous design spent that many times over:
//   - every push first DOWNLOADED the entire row, only to learn its timestamp;
//   - realtime (postgres_changes) shipped the entire row to every open client on every
//     write — including the device that had just written it;
//   - returning to the app downloaded the entire row, twice (visibilitychange and focus
//     both fired), even when nothing had changed;
//   - and two devices could push at each other forever (see comparable() in
//     syncMerge.js), each loop doing all of the above every second or two.
//
// Now:
//   - Each row's state is tracked on-device (`_sync_rows_v1`): the updated_at this device
//     last incorporated, and a signature of the data it last exchanged. "Has anything
//     changed?" is a timestamp-only query costing a few hundred bytes; the data itself is
//     downloaded only when the timestamp moved.
//   - A push is written straight to the server under compare-and-swap against the last
//     timestamp seen. It only reads the row when the swap fails, i.e. when another
//     device really did write in between.
//   - Realtime carries a tiny broadcast ("row X changed at T") instead of the row. Hidden
//     tabs ignore it and catch up when they are next shown, so a laptop left open in the
//     background is not downloading every set logged on the phone.
//   - History (past task days, habit weeks, monthly AI summaries) lives in a second row that is
//     downloaded only when it changes — roughly once a week (see ARCHIVE in syncKeys.js).
//   - A circuit breaker stops automatic pushes if this device keeps pushing without the
//     user editing anything, so a future convergence bug cannot quietly burn the quota.
//
// ── Compatibility ───────────────────────────────────────────────────────────────────
// The main row keeps its frozen `{key: value}` + `__meta_v2` shape, so a phone still
// running an older build keeps working against it. Older builds do not know about the
// archive row; they keep their local history and push it into the main row, where it is
// merged like any other data. That costs egress until every device has updated, but it
// is bounded — nothing pushes in response to it.

import { STATIC_SYNC_KEYS, DYNAMIC_SYNC_PREFIXES, isArchivedKey, archiveCutoff } from './syncKeys.js'
import { META_FIELD, buildSyncMeta, mergeDisabled } from './syncMeta.js'
import { applyRemote } from './syncMerge.js'
import { getActiveDateString } from './dateHelpers.js'

const TABLE = 'app_state'
export const MAIN_ROW = 'dane'
export const ARCHIVE_ROW = 'dane_archive'

const ROW_STATE_KEY = '_sync_rows_v1'          // device-local; listed in SYNC_META_KEYS
const SIGNAL_TOPIC = 'ultradash-sync-signal-v1'
const SIGNAL_EVENT = 'row-changed'

export const DEFAULT_TIMING = {
  pushDebounceMs: 1200,    // wait after an edit before pushing…
  pushMaxWaitMs: 5000,     // …but never defer a push longer than this under constant editing
  retryMs: 30000,          // after a failed push
  pollMs: 120000,          // timestamp check while visible — backstop for missed signals
  focusMinGapMs: 2000,     // focus + visibilitychange fire together; check once
  signalDebounceMs: 800,   // a burst of remote pushes → one download
  breakerWindowMs: 5 * 60 * 1000,
  breakerMax: 6,           // automatic pushes allowed in that window with no local edit
}

const toMs = (ts) => (ts ? new Date(ts).getTime() || 0 : 0)

// ── per-row device state ─────────────────────────────────────────────────────────────
// { [rowId]: { seenMs, seenRaw, sig } }
//   seenMs/seenRaw — updated_at of the newest version of the row this device has fully
//                    merged or written. seenRaw is the server's exact string, used as the
//                    compare-and-swap guard so a sub-millisecond value can still match.
//   sig            — localSignature of this device's data for the row at the moment it was
//                    last in sync with the server (null = the server is known to be
//                    missing something → push). Unchanged signature = nothing to send.
function readRowStates() {
  try { return JSON.parse(localStorage.getItem(ROW_STATE_KEY)) || {} } catch { return {} }
}
function getRowState(id) {
  return readRowStates()[id] || {}
}
function resetRowState(id) {
  const all = readRowStates()
  if (!(id in all)) return
  delete all[id]
  try { localStorage.setItem(ROW_STATE_KEY, JSON.stringify(all)) } catch {}
}
function recordRowState(id, raw, sig) {
  const all = readRowStates()
  const cur = all[id] || {}
  const ms = toMs(raw)
  const next = { ...cur, sig }
  // updated_at only moves forward, so never step back to an older version.
  if (raw && (!cur.seenMs || ms >= cur.seenMs)) { next.seenMs = ms; next.seenRaw = raw }
  all[id] = next
  try { localStorage.setItem(ROW_STATE_KEY, JSON.stringify(all)) } catch {}
}

// ── what each row carries ────────────────────────────────────────────────────────────
function activeRows() {
  // The kill switch drops back to the plain single-row overwrite path.
  return mergeDisabled() ? [MAIN_ROW] : [ARCHIVE_ROW, MAIN_ROW] // archive first: see pushAll
}

function scopeFor(id, cutoff) {
  if (mergeDisabled()) return () => id === MAIN_ROW
  return id === ARCHIVE_ROW
    ? (k) => isArchivedKey(k, cutoff)
    : (k) => !isArchivedKey(k, cutoff)
}

function syncedKeysIn(inScope) {
  const keys = STATIC_SYNC_KEYS.filter(k => inScope(k) && localStorage.getItem(k) !== null)
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && DYNAMIC_SYNC_PREFIXES.some(p => k.startsWith(p)) && inScope(k)) keys.push(k)
  }
  return keys
}

function collectPayload(inScope) {
  const payload = {}
  syncedKeysIn(inScope).forEach(k => {
    const v = localStorage.getItem(k)
    if (v !== null) { try { payload[k] = JSON.parse(v) } catch {} }
  })
  // Rides along as one reserved entry — never a change to the payload's shape, because
  // older builds still in the wild apply it by writing every entry into localStorage.
  if (!mergeDisabled()) payload[META_FIELD] = buildSyncMeta(inScope)
  return payload
}

// Fingerprint of this device's stored data for one row, straight from the stored strings
// (no parsing), so checking whether a large, rarely-changing row needs a push costs almost
// nothing. It only has to answer "has local data changed since we were last in sync?" —
// merges write a key only when its content really changed, so the strings are stable.
function localSignature(inScope) {
  const keys = syncedKeysIn(inScope).sort()
  let h = 0x811c9dc5
  let len = 0
  const feed = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    len += s.length
  }
  keys.forEach(k => {
    feed(k)
    feed('\u0000')
    feed(localStorage.getItem(k) ?? '')
    feed('\u0001')
  })
  if (mergeDisabled()) feed('\u0002plain') // flipping the kill switch changes what a push sends
  return `${keys.length}.${len}.${(h >>> 0).toString(36)}`
}

const hasContent = (payload) => Object.keys(payload).some(k => k !== META_FIELD)

// ─────────────────────────────────────────────────────────────────────────────────────
export function createSyncEngine({
  client,
  notify = () => {},
  onStatus = () => {},
  isVisible = () => true,
  getActiveDate = getActiveDateString,
  timing: timingOverrides = {},
  log = console,
} = {}) {
  const timing = { ...DEFAULT_TIMING, ...timingOverrides }

  let stopped = false
  let initialized = false
  let applying = false
  let status = null

  // Every network operation runs one at a time. Focus, visibility, polling, signals and
  // pushes can all fire together; serialising them means each sees the state the previous
  // one left behind, instead of two of them downloading the same row at once.
  let chain = Promise.resolve()
  const serial = (fn) => {
    const p = chain.then(() => (stopped ? undefined : fn()))
    chain = p.catch(() => {})
    return p
  }

  let pushTimer = null
  let pendingSince = 0
  let retryTimer = null
  let pollTimer = null
  let signalTimer = null
  let lastCheckAt = 0
  let channel = null
  let joined = false
  let everJoined = false

  // In-memory: the version of each row THIS TAB last merged. The persisted state is
  // shared by every tab on this origin, so a row another tab merged looks "already seen"
  // here — this tells us our modules still need to re-read it.
  const appliedMs = {}

  // If the archive row cannot be written (a policy rejecting the new key, say), the main
  // row carries everything and the archive is not attempted again until this passes —
  // otherwise every check would re-upload the archive just to be refused again.
  let archiveBackoffUntil = 0
  const archiveBlocked = () => Date.now() < archiveBackoffUntil

  // Circuit breaker state.
  let editSinceLastSend = false
  let autoSends = []
  let tripped = false

  const setStatus = (s) => {
    if (s === status) return
    status = s
    onStatus(s)
  }

  // ── network primitives ──────────────────────────────────────────────────────────────
  // Tiny: just which rows exist and when they last changed.
  async function fetchHeads(ids) {
    const { data, error } = await client.from(TABLE).select('key, updated_at').in('key', ids)
    if (error) throw error
    const out = {}
    ;(data || []).forEach(r => {
      if (!out[r.key] || toMs(r.updated_at) > toMs(out[r.key].updated_at)) out[r.key] = r
    })
    return out
  }

  // The full row. Ordered + limited rather than .single(), so a duplicated key (two
  // devices racing to create the row) cannot wedge sync.
  async function fetchRow(id) {
    const { data, error } = await client
      .from(TABLE).select('data, updated_at').eq('key', id)
      .order('updated_at', { ascending: false }).limit(1)
    if (error) throw error
    return data?.[0] || null
  }

  function signal(id, at) {
    if (!channel || !joined) return // others catch up on their next check
    try {
      channel.send({ type: 'broadcast', event: SIGNAL_EVENT, payload: { row: id, at } })
        ?.catch?.(() => {})
    } catch {}
  }

  // ── merging ─────────────────────────────────────────────────────────────────────────
  // Returns needsPush, or null if the merge itself failed.
  //
  // `applying` is held while merging so writes it causes are never mistaken for user
  // edits — and the try/finally is load-bearing: a merge that throws (malformed remote
  // data, a storage quota error) must not leave it set, or every later push is ignored
  // for the rest of the session with nothing surfaced anywhere.
  function applyRow(data, remoteMs, inScope) {
    applying = true
    try {
      if (mergeDisabled()) {
        Object.entries(data).forEach(([k, v]) => {
          if (k === META_FIELD) return
          localStorage.setItem(k, JSON.stringify(v))
        })
        notify()
        return false
      }
      const { applied, needsPush } = applyRemote(data, remoteMs, { inScope })
      if (applied) notify()
      return needsPush
    } catch (e) {
      log.warn?.('Sync merge failed:', e)
      return null
    } finally {
      applying = false
    }
  }

  // Download one row and merge it in.
  async function pullRow(id, inScope) {
    const row = await fetchRow(id)
    if (!row) return { missing: true }
    const remoteMs = toMs(row.updated_at)
    const needsPush = row.data ? applyRow(row.data, remoteMs, inScope) : false
    if (needsPush === null) return { failed: true } // leave state alone so the next check retries
    // Local now holds everything the row held. If it also holds nothing the row lacks,
    // what we have IS what the server has; otherwise mark the row as owed a push.
    recordRowState(id, row.updated_at, needsPush ? null : localSignature(inScope))
    appliedMs[id] = remoteMs
    return { needsPush }
  }

  // ── checking for remote changes ─────────────────────────────────────────────────────
  // One timestamp query for both rows; a download only for a row that actually moved.
  async function checkRows({ boot = false } = {}) {
    const cutoff = archiveCutoff(getActiveDate())
    const ids = activeRows()
    const heads = await fetchHeads(ids)
    let owePush = false
    for (const id of ids) {
      // While the archive row is unavailable the main row carries everything — judge it
      // by the same scope its pushes use.
      const inScope = (id === MAIN_ROW && archiveBlocked()) ? () => true : scopeFor(id, cutoff)
      const head = heads[id]
      if (!head) {
        // Row does not exist (yet, or any more). Forget what we knew about it so the push
        // recreates it — but only if we have something to put in it, so an empty device can
        // never create a blank row over data living elsewhere.
        resetRowState(id)
        if (syncedKeysIn(inScope).length && !(id === ARCHIVE_ROW && archiveBlocked())) owePush = true
        continue
      }
      const ms = toMs(head.updated_at)
      if (ms === getRowState(id).seenMs) {
        // Already merged — by this tab, or by another tab on this origin (in which case
        // our modules re-read; no download needed either way).
        if (!boot && appliedMs[id] !== ms) notify()
        appliedMs[id] = ms
        continue
      }
      const r = await pullRow(id, inScope)
      if (r.needsPush || r.missing) owePush = true
    }
    return owePush
  }

  function revalidate(reason = 'focus') {
    if (!initialized || stopped) return Promise.resolve()
    const now = Date.now()
    if (now - lastCheckAt < timing.focusMinGapMs && reason !== 'signal') return Promise.resolve()
    lastCheckAt = now
    return serial(async () => {
      try {
        const owePush = await checkRows()
        if (status === 'offline' || status === 'error') setStatus('synced')
        if (owePush) schedulePush('merge')
      } catch (e) {
        // Network blip — the next focus, poll or signal retries.
      }
    })
  }

  // ── pushing ─────────────────────────────────────────────────────────────────────────
  // Returns 'sent' | 'skip' | 'error'.
  async function pushRow(id, inScope) {
    for (let attempt = 0; attempt < 4; attempt++) {
      let sig = localSignature(inScope)
      const state = getRowState(id)
      if (attempt === 0 && sig === state.sig) return 'skip' // nothing changed since last in sync
      setStatus('syncing')
      let payload = collectPayload(inScope)

      // First attempt: swap straight against the version we last saw — no read at all.
      // Later attempts (the swap failed: someone else wrote) read the timestamp, merge
      // their work in, and try again. Merging makes the retry cheap and order-independent.
      let prior = attempt === 0 ? state.seenRaw : null
      if (!prior) {
        const head = (await fetchHeads([id]))[id]
        if (!head) {
          if (!hasContent(payload)) return 'skip'
          const createdAt = new Date().toISOString()
          const { data, error } = await client
            .from(TABLE).insert({ key: id, data: payload, updated_at: createdAt }).select('updated_at')
          if (error) {
            // A racing device created it first → go round again as an update. Anything
            // else (permissions, network) will not fix itself by retrying immediately.
            if (error.code === '23505') continue
            log.warn?.('Sync insert failed:', error)
            return 'error'
          }
          const raw = data?.[0]?.updated_at || createdAt
          recordRowState(id, raw, sig)
          appliedMs[id] = toMs(raw)
          signal(id, raw)
          return 'sent'
        }
        // Guard with the server's own string for the version we are building on.
        prior = head.updated_at
        if (toMs(head.updated_at) !== getRowState(id).seenMs) {
          const r = await pullRow(id, inScope)
          if (r.failed) return 'error'
          if (r.missing) continue
          if (!r.needsPush) return 'skip' // after merging, the server already holds all of ours
          prior = getRowState(id).seenRaw || head.updated_at // the version just merged
        }
        sig = localSignature(inScope)
        payload = collectPayload(inScope)
      }

      // Always advance the timestamp, even if this device's clock lags the other's —
      // otherwise the guard value never moves and a concurrent writer could match it twice.
      const nextIso = new Date(Math.max(Date.now(), toMs(prior) + 1)).toISOString()
      const { data, error } = await client
        .from(TABLE)
        .update({ data: payload, updated_at: nextIso })
        .eq('key', id)
        .eq('updated_at', prior)   // ← applies only if nobody wrote in between
        .select('updated_at')
      if (error) {
        log.warn?.('Sync push failed:', error)
        return 'error'
      }
      if (!data?.length) continue  // someone wrote first (or the row is gone) → read, merge, retry
      const raw = data[0].updated_at || nextIso
      recordRowState(id, raw, sig)
      appliedMs[id] = toMs(raw)
      signal(id, raw)
      return 'sent'
    }
    return 'error' // repeated collisions; the retry timer or the next edit tries again
  }

  async function pushAll() {
    const startedOffline = status === 'offline'
    const cutoff = archiveCutoff(getActiveDate())
    let archiveOk = true
    let mainOk = true
    let sent = false
    // Archive first. If it fails, the main row keeps carrying the history this round, so
    // a day leaving the main row can never exist on no server row at all — and nothing is
    // lost, so an archive failure alone is not shown as a sync error.
    for (const id of activeRows()) {
      if (id === ARCHIVE_ROW && archiveBlocked()) { archiveOk = false; continue }
      const inScope = (id === MAIN_ROW && !archiveOk) ? () => true : scopeFor(id, cutoff)
      let result
      try {
        result = await pushRow(id, inScope)
      } catch (e) {
        log.warn?.('Sync push failed:', e)
        result = 'error'
      }
      if (result === 'sent') sent = true
      if (result === 'error') {
        if (id === ARCHIVE_ROW) {
          archiveOk = false
          archiveBackoffUntil = Date.now() + timing.retryMs * 10
        } else {
          mainOk = false
        }
      }
    }
    if (sent) noteSent()
    const retryIn = (ms) => {
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => { retryTimer = null; schedulePush('retry') }, ms)
    }
    if (!mainOk) retryIn(timing.retryMs)
    else if (!archiveOk && !retryTimer) retryIn(timing.retryMs * 10 + 50) // just after the backoff
    if (!mainOk) setStatus(startedOffline ? 'offline' : 'error') // still offline, not a new fault
    else if (!startedOffline || sent) setStatus('synced')
  }

  // ── circuit breaker ─────────────────────────────────────────────────────────────────
  // A push the user caused (an edit) is always allowed. A push the ENGINE decided on
  // (after a merge, at boot, on retry) is counted; too many of those in a row with no
  // edit in between means two devices are disagreeing about something, and pushing more
  // will only bounce it back again. Stop and say so instead of spending the quota.
  function noteSent() {
    const now = Date.now()
    if (editSinceLastSend) {
      editSinceLastSend = false
      autoSends = []
      return
    }
    autoSends = autoSends.filter(t => now - t < timing.breakerWindowMs)
    autoSends.push(now)
    if (autoSends.length >= timing.breakerMax && !tripped) {
      tripped = true
      log.warn?.('Sync: paused automatic pushes — this device pushed ' + autoSends.length +
        ' times without a local edit, which means devices are disagreeing. Your next edit (or reload) resumes.')
    }
  }

  function schedulePush(reason = 'edit') {
    if (stopped || !initialized) return
    if (reason === 'edit') {
      if (applying) return // a write caused by applying remote data is not a user edit
      editSinceLastSend = true
      tripped = false
    } else if (tripped) {
      return
    }
    const now = Date.now()
    if (!pendingSince) pendingSince = now
    clearTimeout(pushTimer)
    const delay = Math.max(0, Math.min(timing.pushDebounceMs, timing.pushMaxWaitMs - (now - pendingSince)))
    pushTimer = setTimeout(() => {
      // Clear the handle as the timer fires: flushPush treats a non-null handle as "a push
      // is still pending".
      pushTimer = null
      pendingSince = 0
      serial(pushAll)
    }, delay)
  }

  // Send anything still pending now — used when the tab is hidden, because an edit made
  // in the last second would otherwise wait for a timer that may never fire.
  function flushPush() {
    if (!pushTimer) return Promise.resolve()
    clearTimeout(pushTimer)
    pushTimer = null
    pendingSince = 0
    return serial(pushAll)
  }

  function onSignal(payload) {
    if (stopped || !payload?.row) return
    // Already have that version — another tab on this origin wrote or merged it into the
    // storage we share. Nothing to download; our modules just need to re-read.
    const seenMs = getRowState(payload.row).seenMs || 0
    if (payload.at && toMs(payload.at) <= seenMs) {
      if (appliedMs[payload.row] !== seenMs) { appliedMs[payload.row] = seenMs; notify() }
      return
    }
    // A hidden tab catches up when it is next shown — no download while nobody is looking.
    if (!isVisible()) return
    clearTimeout(signalTimer)
    signalTimer = setTimeout(() => revalidate('signal'), timing.signalDebounceMs)
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────
  async function start() {
    setStatus('syncing')
    await serial(async () => {
      try {
        // Boot is a check like any other: rows unchanged since this device last synced are
        // NOT downloaded. Unpushed edits from last session show up as a signature mismatch
        // and go out with the boot push below.
        await checkRows({ boot: true })
        setStatus('synced')
      } catch (e) {
        log.warn?.('Sync init failed:', e)
        setStatus('offline')
      }
    })
    if (stopped) return
    // Only now may pushes reach the server: the remote state has been taken in first.
    initialized = true
    schedulePush('boot')

    try {
      channel = client
        .channel(SIGNAL_TOPIC, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: SIGNAL_EVENT }, (msg) => onSignal(msg?.payload))
        .subscribe((s) => {
          joined = s === 'SUBSCRIBED'
          if (joined) {
            // Re-joining after a drop: anything signalled meanwhile was missed.
            if (everJoined) revalidate('signal')
            everJoined = true
          }
        })
    } catch (e) {
      log.warn?.('Sync signal channel failed:', e)
    }
    pollTimer = setInterval(() => { if (isVisible()) revalidate('poll') }, timing.pollMs)
  }

  function stop() {
    stopped = true
    clearTimeout(pushTimer)
    clearTimeout(retryTimer)
    clearTimeout(signalTimer)
    clearInterval(pollTimer)
    if (channel) {
      try { client.removeChannel ? client.removeChannel(channel) : channel.unsubscribe() } catch {}
      channel = null
    }
  }

  return {
    start,
    stop,
    schedulePush,
    flushPush,
    revalidate,
    // For tests and debugging.
    _state: () => ({ initialized, tripped, autoSends: autoSends.length, joined, status }),
  }
}
