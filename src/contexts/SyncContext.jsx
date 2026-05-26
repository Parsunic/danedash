import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { storeGet } from '../lib/storage.js'
import { getActiveDateString, getTomorrowDateString } from '../lib/dateHelpers.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://wlrdwrlxkjgubdmntfxl.supabase.co'
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_yUHmrdeFSaKfY-AMGp3r9Q_Q2Mbqh7Y'
const SYNC_ROW_ID = 'dane'

const SyncContext = createContext({ status: 'offline' })

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
        const { data: row, error } = await client
          .from('app_state').select('data').eq('key', SYNC_ROW_ID).single()
        if (error) {
          if (error.code === 'PGRST116') {
            await pushToSupabase()
          } else {
            console.warn('Sync pull failed:', error)
            setStatus('error')
            return
          }
        } else if (row?.data) {
          isSyncingRef.current = true
          applyRemotePayload(row.data)
          isSyncingRef.current = false
        }
        setStatus('synced')
        initializedRef.current = true
        channel = client.channel('dashboard-sync')
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'app_state', filter: `key=eq.${SYNC_ROW_ID}`,
          }, change => {
            if (change.new?.data) {
              isSyncingRef.current = true
              applyRemotePayload(change.new.data)
              isSyncingRef.current = false
              setStatus('synced')
            }
          })
          .subscribe()
      } catch (e) {
        console.warn('Sync init failed:', e)
        setStatus('offline')
      }
    }
    initSync()
    return () => {
      if (channel) channel.unsubscribe()
    }
  }, [pushToSupabase])

  return (
    <SyncContext.Provider value={{ status }}>
      {children}
    </SyncContext.Provider>
  )
}
