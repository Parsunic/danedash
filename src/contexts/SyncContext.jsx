import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { storeGet } from '../lib/storage.js'
import { getActiveDateString, getTomorrowDateString } from '../lib/dateHelpers.js'

const SYNC_ROW_ID = 'dane'

const SyncContext = createContext({ status: 'offline', isOffline: false })

export function useSyncStatus() {
  return useContext(SyncContext)
}

function getLocalPayload() {
  const payload = {}
  const today = getActiveDateString()
  const tomorrow = getTomorrowDateString()
  const keys = [
    'goals:' + today, 'goals:' + tomorrow,
    'recurring_tasks', 'goal_streak_v1',
    'gym_templates', 'gym_planned', 'gym_week_tpls', 'gym_workout_logs', 'gym_exercise_history',
    'calendar_events',
    'journal_entries',
  ]
  keys.forEach(k => {
    const v = localStorage.getItem(k)
    if (v !== null) { try { payload[k] = JSON.parse(v) } catch {} }
  })
  return payload
}

function applyRemotePayload(payload) {
  if (!payload) return
  Object.entries(payload).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)))
  window.dispatchEvent(new CustomEvent('goals-changed'))
  window.dispatchEvent(new CustomEvent('gym-changed'))
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
        const client = createClient(SUPABASE_URL, SUPABASE_KEY)
        clientRef.current = client
        setStatus('syncing')
        setIsOffline(false)

        // Supabase is always the source of truth on load.
        // We READ from Supabase and hydrate localStorage — never the reverse.
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
          // Remote data fetched — overwrite localStorage entirely.
          // Do NOT let any local write trigger a push during this phase (isSyncingRef guard).
          isSyncingRef.current = true
          applyRemotePayload(row.data)
          isSyncingRef.current = false
          setStatus('synced')
        } else {
          setStatus('synced')
        }

        // Mark initialization complete only AFTER Supabase data has been applied.
        // schedulePush checks this flag — no local push can reach Supabase before this point.
        initializedRef.current = true

        channel = client.channel('dashboard-sync')
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'app_state', filter: `key=eq.${SYNC_ROW_ID}`,
          }, change => {
            if (change.new?.data) {
              // Remote change from another device — Supabase wins, overwrite local.
              isSyncingRef.current = true
              applyRemotePayload(change.new.data)
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
  }, [pushToSupabase])

  return (
    <SyncContext.Provider value={{ status, isOffline }}>
      {children}
    </SyncContext.Provider>
  )
}
