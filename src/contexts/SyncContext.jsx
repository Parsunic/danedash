import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { STATIC_SYNC_KEYS, DYNAMIC_SYNC_PREFIXES } from '../lib/syncKeys.js'
import { META_FIELD, buildSyncMeta, mergeDisabled } from '../lib/syncMeta.js'
import { applyRemote } from '../lib/syncMerge.js'

const SYNC_ROW_ID = 'dane'

// How long to wait after an edit before pushing, and the longest a push can be deferred
// by continuous editing. Without the ceiling, a steady stream of edits (logging set after
// set) resets the timer forever and nothing reaches the server until you stop.
const PUSH_DEBOUNCE_MS = 1200
const PUSH_MAX_WAIT_MS = 5000

const SyncContext = createContext({ status: 'offline', isOffline: false })

export function useSyncStatus() {
  return useContext(SyncContext)
}

function getLocalPayload() {
  const payload = {}

  // Static keys
  STATIC_SYNC_KEYS.forEach(k => {
    const v = localStorage.getItem(k)
    if (v !== null) { try { payload[k] = JSON.parse(v) } catch {} }
  })

  // Dynamic-prefix keys: enumerate all matching localStorage entries
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    if (DYNAMIC_SYNC_PREFIXES.some(p => k.startsWith(p))) {
      const v = localStorage.getItem(k)
      if (v !== null) { try { payload[k] = JSON.parse(v) } catch {} }
    }
  }

  // Ride along as one reserved entry — never a change to the payload's shape, because
  // older builds still in the wild apply it by writing every entry into localStorage.
  if (!mergeDisabled()) payload[META_FIELD] = buildSyncMeta()

  return payload
}

// Bring remote data in and notify every feature module to re-read.
//
// This MERGES rather than overwrites: each key, and each record inside the list keys,
// resolves to whichever side changed it most recently. That is what stops an edit made
// on one device from being destroyed by an unrelated edit made on another a second
// later. Writes go through raw setItem so applying remote data never registers as a
// local edit or echoes a push back.
//
// Returns true when the merged result differs from what the server holds — meaning the
// server is missing something of ours and we owe it a push.
function applyRemotePayload(payload, remoteMs) {
  if (!payload) return false
  if (mergeDisabled()) {
    Object.entries(payload).forEach(([k, v]) => {
      if (k === META_FIELD) return
      localStorage.setItem(k, JSON.stringify(v))
    })
    notifyModules()
    return false
  }
  const { applied, needsPush } = applyRemote(payload, remoteMs)
  if (applied) notifyModules()
  return needsPush
}

// Apply remote data with the "we are syncing" guard held.
//
// The try/finally is load-bearing. That guard makes every push and every scheduled push
// early-return while it is set, so if the merge throws — malformed remote data, a
// storage quota error — a leaked flag would disable syncing for the rest of the session
// with nothing surfaced anywhere. Failing a single merge is recoverable; silently
// failing every future one is not.
function applyGuarded(ref, payload, remoteMs) {
  ref.current = true
  try {
    return applyRemotePayload(payload, remoteMs)
  } catch (e) {
    console.warn('Sync merge failed:', e)
    return false
  } finally {
    ref.current = false
  }
}

function notifyModules() {
  window.dispatchEvent(new CustomEvent('goals-changed'))
  window.dispatchEvent(new CustomEvent('gym-changed'))
  window.dispatchEvent(new CustomEvent('sync-applied'))
}

const toMs = (ts) => (ts ? new Date(ts).getTime() : 0)

export function SyncProvider({ children }) {
  const [status, setStatus] = useState('offline')
  const [isOffline, setIsOffline] = useState(false)
  const clientRef = useRef(null)
  const debounceRef = useRef(null)
  const pendingSinceRef = useRef(0)
  const isSyncingRef = useRef(false)
  const initializedRef = useRef(false)
  // Exact updated_at (ms) of the row WE last pushed, so the realtime echo of our own
  // write can be ignored instead of re-applied.
  const lastPushedMsRef = useRef(0)

  // Push with a compare-and-swap guard.
  //
  // The old push read nothing and overwrote the row unconditionally. Two devices woken by
  // the same realtime event would both write within a few hundred milliseconds and the
  // second one silently erased the first. Here the update only applies if the row is
  // still exactly as we last saw it; if another device got in first we re-read, merge
  // their work into ours, and try again. Merging makes the retry cheap and near-order-
  // independent, so two attempts cover any realistic collision.
  //
  // `upsert` cannot express the guard — it compiles to INSERT … ON CONFLICT DO UPDATE
  // with no WHERE — so the insert and update paths are separate.
  const pushToSupabase = useCallback(async (attempt = 0) => {
    const client = clientRef.current
    if (!client || isSyncingRef.current) return
    setStatus('syncing')

    const { data: row, error: readErr } = await client
      .from('app_state').select('data, updated_at').eq('key', SYNC_ROW_ID).single()

    // No row yet — create it. A racing device may create it first; that surfaces as a
    // duplicate-key error, which just means "someone beat us", so retry as an update.
    if (readErr?.code === 'PGRST116') {
      const updatedAt = new Date().toISOString()
      lastPushedMsRef.current = toMs(updatedAt)
      const { error } = await client
        .from('app_state').insert({ key: SYNC_ROW_ID, data: getLocalPayload(), updated_at: updatedAt })
      if (error && attempt < 2) return pushToSupabase(attempt + 1)
      setStatus(error ? 'error' : 'synced')
      if (error) console.warn('Sync insert failed:', error)
      return
    }
    if (readErr) {
      console.warn('Sync push read failed:', readErr)
      setStatus('error')
      return
    }

    // Fold whatever the server gained since we last looked into our own state, so the
    // push adds to the other device's work instead of replacing it.
    const priorIso = new Date(row.updated_at).toISOString()
    if (row.data && toMs(row.updated_at) !== lastPushedMsRef.current) {
      isSyncingRef.current = true
      applyRemotePayload(row.data, toMs(row.updated_at))
      isSyncingRef.current = false
    }

    // Always advance the timestamp, even if this device's clock lags the other's —
    // otherwise the guard value never moves and a concurrent writer could match it twice.
    const nextIso = new Date(Math.max(Date.now(), Date.parse(priorIso) + 1)).toISOString()
    lastPushedMsRef.current = toMs(nextIso)
    const { data: updated, error } = await client
      .from('app_state')
      .update({ data: getLocalPayload(), updated_at: nextIso })
      .eq('key', SYNC_ROW_ID)
      .eq('updated_at', priorIso)   // ← applies only if nobody wrote in between
      .select('updated_at')

    if (error) {
      console.warn('Sync push failed:', error)
      setStatus('error')
      return
    }
    if (!updated?.length) {
      // Someone wrote first. Re-read, re-merge, retry.
      if (attempt < 2) return pushToSupabase(attempt + 1)
      setStatus('synced') // their write will reach us over realtime; nothing is lost
      return
    }
    setStatus('synced')
  }, [])

  const schedulePush = useCallback(() => {
    if (isSyncingRef.current || !initializedRef.current) return
    const now = Date.now()
    if (!pendingSinceRef.current) pendingSinceRef.current = now
    clearTimeout(debounceRef.current)
    const waited = now - pendingSinceRef.current
    const delay = Math.max(0, Math.min(PUSH_DEBOUNCE_MS, PUSH_MAX_WAIT_MS - waited))
    debounceRef.current = setTimeout(() => {
      pendingSinceRef.current = 0
      pushToSupabase()
    }, delay)
  }, [pushToSupabase])

  // Send anything still pending immediately, without waiting out the debounce.
  const flushPush = useCallback(() => {
    if (!debounceRef.current) return
    clearTimeout(debounceRef.current)
    debounceRef.current = null
    pendingSinceRef.current = 0
    pushToSupabase()
  }, [pushToSupabase])

  useEffect(() => {
    const handler = () => schedulePush()
    window.addEventListener('schedule-sync', handler)
    return () => window.removeEventListener('schedule-sync', handler)
  }, [schedulePush])

  // Flush when the tab is hidden — switching apps, locking the phone, closing the laptop.
  // An edit made in the last second used to be lost outright: the push never fired, but
  // the device still counted itself as having edited, so it would win the next startup
  // comparison and push its incomplete state over the other device's.
  //
  // `hidden` and not `pagehide`: a hidden page stays alive long enough to finish the
  // request, whereas pagehide gives no time for one. A hard tab-kill can still drop the
  // last second of edits, which the next launch re-pushes anyway.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushPush() }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [flushPush])

  // Re-pull when the tab regains focus/visibility. Realtime websockets are dropped while a
  // tab is backgrounded (e.g. computer left idle while you work out on your phone), so on
  // return the local data can be stale. This is the reliable backstop for cross-device sync.
  //
  // There is no longer a "who wins" decision here. Merging is symmetric, so the answer is
  // always "merge, then push if we hold anything the server is missing" — a device can
  // never talk itself out of accepting remote data, and never has to.
  const revalidate = useCallback(async () => {
    if (!clientRef.current || !initializedRef.current || isSyncingRef.current) return
    try {
      const { data: row, error } = await clientRef.current
        .from('app_state').select('data, updated_at').eq('key', SYNC_ROW_ID).single()
      if (error || !row?.data) return
      const remoteMs = toMs(row.updated_at)
      if (remoteMs === lastPushedMsRef.current) return // our own write echoed back
      isSyncingRef.current = true
      const needsPush = applyRemotePayload(row.data, remoteMs)
      isSyncingRef.current = false
      setStatus('synced')
      if (needsPush) schedulePush()
    } catch (e) {
      // Network blip on revalidation — ignore, the next focus/realtime event will retry.
    }
  }, [schedulePush])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') revalidate() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [revalidate])

  useEffect(() => {
    let channel = null
    async function initSync() {
      try {
        const client = supabase
        clientRef.current = client
        setStatus('syncing')
        setIsOffline(false)

        const { data: row, error } = await client
          .from('app_state').select('data, updated_at').eq('key', SYNC_ROW_ID).single()

        let pushAfterInit = false

        if (error) {
          if (error.code === 'PGRST116') {
            // No row exists yet — brand-new user or row was deleted.
            // Only seed Supabase if local actually has content, so an empty/stale device
            // can't create a blank row that wipes data living on another device.
            // Bookkeeping doesn't count as content — it is present on every device,
            // including one that has nothing to seed.
            const localData = getLocalPayload()
            if (Object.keys(localData).some(k => k !== META_FIELD)) {
              await pushToSupabase()
            } else {
              setStatus('synced')
            }
          } else {
            // Supabase reachable but returned an unexpected error — treat as offline.
            console.warn('Sync pull failed:', error)
            setStatus('offline')
            setIsOffline(true)
            initializedRef.current = true
            return
          }
        } else if (row?.data) {
          // No boot-time "who wins" decision any more. The old one compared a single
          // global marker against the row's timestamp and could talk this device into
          // skipping the pull entirely, then pushing stale data over good remote data.
          // Merging is symmetric and safe in both directions, so we always take the
          // server's data in, and push back only what it turns out to be missing.
          const remoteMs = toMs(row.updated_at)
          isSyncingRef.current = true
          pushAfterInit = applyRemotePayload(row.data, remoteMs)
          isSyncingRef.current = false
          setStatus('synced')
        } else {
          setStatus('synced')
        }

        // Mark initialization complete only AFTER the remote decision is made.
        // schedulePush checks this flag — no local push can reach Supabase before this point.
        initializedRef.current = true

        // Our pre-load local data was genuinely newer than the server → push it now.
        if (pushAfterInit) schedulePush()

        channel = client.channel('dashboard-sync')
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'app_state', filter: `key=eq.${SYNC_ROW_ID}`,
          }, change => {
            if (!change.new?.data) return
            const remoteMs = toMs(change.new.updated_at)
            if (remoteMs === lastPushedMsRef.current) return // ignore echo of our own push
            // Incoming changes are ALWAYS merged. Previously a change that looked older
            // than our last local edit was silently dropped with no reconciliation, so
            // the two devices simply stayed different until something else broke the
            // tie — which is why these bugs reproduced so inconsistently.
            isSyncingRef.current = true
            const needsPush = applyRemotePayload(change.new.data, remoteMs)
            isSyncingRef.current = false
            setStatus('synced')
            if (needsPush) schedulePush()
          })
          .subscribe()
      } catch (e) {
        // Network unreachable — fall back to localStorage (offline mode).
        console.warn('Sync init failed:', e)
        setStatus('offline')
        setIsOffline(true)
        initializedRef.current = true
      }
    }
    initSync()
    return () => {
      if (channel) channel.unsubscribe()
    }
  }, [pushToSupabase, schedulePush])

  return (
    <SyncContext.Provider value={{ status, isOffline }}>
      {children}
    </SyncContext.Provider>
  )
}
