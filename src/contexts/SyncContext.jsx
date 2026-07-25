import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { STATIC_SYNC_KEYS, DYNAMIC_SYNC_PREFIXES } from '../lib/syncKeys.js'
import { META_FIELD, buildSyncMeta, mergeDisabled } from '../lib/syncMeta.js'
import { applyRemote } from '../lib/syncMerge.js'

const SYNC_ROW_ID = 'dane'

// Snapshot of the last genuine local edit AT PAGE LOAD, captured before any startup
// writes (migrations, rollovers, on-mount normalizations) run. This is the linchpin of
// the conflict resolution: the initial remote pull is decided against THIS value, not the
// live _lastLocalChange. Automated writes during the async pull window bump the live marker
// to "now," which previously made a fresh reload look like it held newer edits than the
// server — causing the pull to be skipped and stale local data to be pushed over good
// remote data (e.g. a workout logged on another device got reverted). By comparing the
// server against this boot-time snapshot, post-boot automated writes can no longer hijack
// the decision. See storeSetSilent in storage.js for the companion guard.
const BOOT_LOCAL_CHANGE = parseInt(localStorage.getItem('_lastLocalChange') || '0')

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
  const isSyncingRef = useRef(false)
  const initializedRef = useRef(false)
  // Exact updated_at (ms) of the row WE last pushed, so the realtime echo of our own
  // write can be ignored instead of re-applied.
  const lastPushedMsRef = useRef(0)

  const pushToSupabase = useCallback(async () => {
    if (!clientRef.current || isSyncingRef.current) return
    setStatus('syncing')
    const data = getLocalPayload()
    const updatedAt = new Date().toISOString()
    lastPushedMsRef.current = toMs(updatedAt)
    const { error } = await clientRef.current
      .from('app_state')
      .upsert({ key: SYNC_ROW_ID, data, updated_at: updatedAt })
    setStatus(error ? 'error' : 'synced')
    if (error) console.warn('Sync push failed:', error)
  }, [])

  const schedulePush = useCallback(() => {
    if (isSyncingRef.current || !initializedRef.current) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(pushToSupabase, 1500)
  }, [pushToSupabase])

  useEffect(() => {
    const handler = () => schedulePush()
    window.addEventListener('schedule-sync', handler)
    return () => window.removeEventListener('schedule-sync', handler)
  }, [schedulePush])

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
