import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

// Keys that must sync — updated whenever a new feature adds persistent localStorage data.
// Rule: every storeSet key used by any module must appear here or in the dynamic-key section.
const STATIC_SYNC_KEYS = [
  // Goals / Tasks
  'goal_streak_v1',
  'goals_projects',
  'general_tasks',
  'recurring_tasks',
  // Habits
  'habits',
  // Gym
  'gym_templates', 'gym_planned', 'gym_week_tpls', 'gym_workout_logs', 'gym_exercise_history', 'custom_exercises', 'gym_settings',
  // Calendar
  'calendar_events',
  // Journal
  'journal_entries',
]

// Key prefixes whose instances are enumerated at push time (one key per date/week).
const DYNAMIC_SYNC_PREFIXES = [
  'goals:',        // today's and all future/past task lists
  'habits_log:',   // one key per calendar week
  'daily_focus:',  // today's thematic focus (one per date)
]

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

  return payload
}

// Write remote data into localStorage and notify every feature module to re-read.
// Uses raw setItem (not storeSet) so applying remote data does NOT register as a local
// edit and does NOT trigger a push back to the server.
function writeRemotePayload(payload) {
  if (!payload) return
  Object.entries(payload).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)))
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
  // return the local data can be stale. This fetches the server and applies it when it is
  // newer than our last genuine local edit — the reliable backstop for cross-device sync.
  const revalidate = useCallback(async () => {
    if (!clientRef.current || !initializedRef.current || isSyncingRef.current) return
    try {
      const { data: row, error } = await clientRef.current
        .from('app_state').select('data, updated_at').eq('key', SYNC_ROW_ID).single()
      if (error || !row?.data) return
      const remoteMs = toMs(row.updated_at)
      if (remoteMs === lastPushedMsRef.current) return // our own write echoed back
      const lastLocalChange = parseInt(localStorage.getItem('_lastLocalChange') || '0')
      if (remoteMs >= lastLocalChange) {
        // Server is newer than our last local edit → pull it in.
        isSyncingRef.current = true
        writeRemotePayload(row.data)
        isSyncingRef.current = false
        setStatus('synced')
      } else {
        // We hold genuinely newer local edits (e.g. made while offline) → push them up.
        schedulePush()
      }
    } catch (e) {
      // Network blip on revalidation — ignore, the next focus/realtime event will retry.
    }
  }, [])

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
            const localData = getLocalPayload()
            if (Object.keys(localData).length > 0) {
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
          // Decide against the BOOT snapshot, NOT the live marker. If the server is at least
          // as new as our last pre-load edit, the server wins (covers the reverted-workout
          // bug). Only when our pre-load local edits are genuinely newer do we keep local
          // and push it up.
          const remoteMs = toMs(row.updated_at)
          isSyncingRef.current = true
          if (remoteMs >= BOOT_LOCAL_CHANGE) {
            writeRemotePayload(row.data)
          } else {
            pushAfterInit = true
          }
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
            // Apply only if the incoming change is newer than our last genuine local edit.
            const lastLocalChange = parseInt(localStorage.getItem('_lastLocalChange') || '0')
            if (remoteMs >= lastLocalChange) {
              isSyncingRef.current = true
              writeRemotePayload(change.new.data)
              isSyncingRef.current = false
              setStatus('synced')
            }
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
