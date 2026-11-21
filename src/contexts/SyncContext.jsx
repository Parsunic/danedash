import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { createSyncEngine } from '../lib/syncEngine.js'

// Wires the sync engine (src/lib/syncEngine.js) to the page. The protocol — merging,
// compare-and-swap pushes, timestamp-only checks, the archive row, the change signal and
// the circuit breaker — lives there; this file only decides WHEN to call it.

const SyncContext = createContext({ status: 'offline', isOffline: false })

export function useSyncStatus() {
  return useContext(SyncContext)
}

// After remote data is merged in, every feature module re-reads.
function notifyModules() {
  window.dispatchEvent(new CustomEvent('goals-changed'))
  window.dispatchEvent(new CustomEvent('gym-changed'))
  window.dispatchEvent(new CustomEvent('sync-applied'))
}

export function SyncProvider({ children }) {
  // 'syncing' until the first check resolves, so the offline banner never flashes at boot.
  const [status, setStatus] = useState('syncing')

  useEffect(() => {
    const engine = createSyncEngine({
      client: supabase,
      notify: notifyModules,
      onStatus: setStatus,
      isVisible: () => document.visibilityState === 'visible',
    })
    engine.start()

    // A genuine edit (storeSet / storeDelete) → debounced push.
    const onEdit = () => engine.schedulePush('edit')

    // Hidden (switching apps, locking the phone): send anything pending now — a hidden page
    // stays alive long enough to finish the request, whereas pagehide gives no time.
    // Visible again: check whether another device changed anything while we were away.
    // Realtime sockets are dropped while a tab is backgrounded, so this is the reliable
    // backstop. visibilitychange and focus usually fire together; the engine checks once.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') engine.flushPush()
      else engine.revalidate('focus')
    }
    const onFocus = () => engine.revalidate('focus')

    window.addEventListener('schedule-sync', onEdit)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('schedule-sync', onEdit)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      engine.stop()
    }
  }, [])

  return (
    <SyncContext.Provider value={{ status, isOffline: status === 'offline' }}>
      {children}
    </SyncContext.Provider>
  )
}
