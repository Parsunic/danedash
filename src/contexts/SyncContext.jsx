import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { storeGet } from '../lib/storage.js'

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
  'goals:',       // today's and all future/past task lists
  'habits_log:',  // one key per calendar week
]

const SYNC_ROW_ID = 'dane'

// Set once per page load — used to distinguish "old _lastLocalChange from a prior session"
// vs "changes made in this browser session." Only current-session changes should block
// a remote pull; stale _lastLocalChange values must not prevent initial sync from applying.
const SESSION_START = Date.now()

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

// Only apply remote payload if it's newer than any local changes made THIS SESSION.
// The SESSION_START guard is critical: _lastLocalChange persists across page loads, so
// a device opened fresh after being idle will have a stale timestamp that looks "newer"
// than Supabase, blocking the pull and then pushing stale data overtop of the remote.
// By requiring lastLocalChange > SESSION_START, only in-flight writes from the current
// browser session can block a remote pull.
function applyRemotePayload(payload, remoteUpdatedAt) {
  if (!payload) return
  if (remoteUpdatedAt) {
    const lastLocalChange = parseInt(localStorage.getItem('_lastLocalChange') || '0')
    const remoteMs = new Date(remoteUpdatedAt).getTime()
    if (lastLocalChange > remoteMs && lastLocalChange > SESSION_START) return
  }
  Object.entries(payload).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)))
  // Notify all feature modules that remote data has been applied.
  // Each module listens for the event(s) it cares about and re-reads from localStorage.
  window.dispatchEvent(new CustomEvent('goals-changed'))
  window.dispatchEvent(new CustomEvent('gym-changed'))
  window.dispatchEvent(new CustomEvent('sync-applied'))
}

export function SyncProvider({ children }) {
  const [status, setStatus] = useState('offline')
  const [isOffline, setIsOffline] = useState(false)
  const clientRef = useRef(null)
  const debounceRef = useRef(null)
  const isSyncingRef = useRef(false)
  const initializedRef = useRef(false)

  const pushToSupabase = useCallback(async () => {
    if (!clientRef.current || isSyncingRef.current) return
    setStatus('syncing')
    const data = getLocalPayload()
    const { error } = await clientRef.current
      .from('app_state')
      .upsert({ key: SYNC_ROW_ID, data, updated_at: new Date().toISOString() })
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

        if (error) {
          if (error.code === 'PGRST116') {
            // No row exists yet — brand-new user or row was deleted.
            // Only push local data to seed Supabase if local actually has content.
            // This guard prevents an empty or stale mobile device from creating a blank row
            // and overwriting data that exists on another device.
            const localData = getLocalPayload()
            if (Object.keys(localData).length > 0) {
              await pushToSupabase()
            } else {
              setStatus('synced')
            }
          } else {
            // Supabase is reachable but returned an unexpected error — treat as offline.
            // Fall back to cached localStorage data and allow local writes to proceed.
            console.warn('Sync pull failed:', error)
            setStatus('offline')
            setIsOffline(true)
            // Allow writes so the user isn't blocked; they'll sync when connectivity returns.
            initializedRef.current = true
            return
          }
        } else if (row?.data) {
          // Remote data fetched — apply only if newer than any local changes.
          // Do NOT let any local write trigger a push during this phase (isSyncingRef guard).
          isSyncingRef.current = true
          applyRemotePayload(row.data, row.updated_at)
          isSyncingRef.current = false
          setStatus('synced')
        } else {
          setStatus('synced')
        }

        // Mark initialization complete only AFTER Supabase data has been applied.
        // schedulePush checks this flag — no local push can reach Supabase before this point.
        initializedRef.current = true

        // If local changes were made during the async fetch window (and therefore blocked
        // from pushing by isSyncingRef), kick off a push now that init is complete.
        // SESSION_START guard prevents stale _lastLocalChange from previous sessions
        // from triggering a push that would overwrite the remote data we just applied.
        const lastLocalChange = parseInt(localStorage.getItem('_lastLocalChange') || '0')
        const remoteMs = row?.updated_at ? new Date(row.updated_at).getTime() : 0
        if (lastLocalChange > remoteMs && lastLocalChange > SESSION_START) schedulePush()

        channel = client.channel('dashboard-sync')
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'app_state', filter: `key=eq.${SYNC_ROW_ID}`,
          }, change => {
            if (change.new?.data) {
              // Remote change — apply only if newer than any local changes.
              isSyncingRef.current = true
              applyRemotePayload(change.new.data, change.new.updated_at)
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
        // Allow local writes to proceed so the user isn't blocked while offline.
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
