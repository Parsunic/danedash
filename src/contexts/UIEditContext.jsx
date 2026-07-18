import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { getLayoutMode, setLayoutMode as persistLayoutMode } from '../lib/cards/layoutStore.js'

// Global card-edit state. `editing` is plain React state — NEVER persisted or
// synced. Entered ONLY via Settings (no long-press). Survives route changes.
const DEFAULT_VALUE = {
  editing: false,
  startEditing: () => {},
  stopEditing: () => {},
  layoutMode: 'manual',
  setLayoutMode: () => {},
}

const UIEditContext = createContext(DEFAULT_VALUE)

// Safe outside the provider: consumers get inert defaults instead of crashing.
export function useUIEdit() {
  return useContext(UIEditContext)
}

export function UIEditProvider({ children }) {
  const [editing, setEditing] = useState(false)
  const [layoutMode, setLayoutModeState] = useState(getLayoutMode)

  const startEditing = useCallback(() => setEditing(true), [])
  const stopEditing = useCallback(() => setEditing(false), [])

  // USER GESTURE ONLY (Settings control / adopt-auto) — persists via storeSet.
  const setLayoutMode = useCallback(mode => {
    const next = mode === 'auto' ? 'auto' : 'manual'
    persistLayoutMode(next)
    setLayoutModeState(next)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('dc-editing', editing)
    window.__uiEditing = editing
    return () => {
      document.body.classList.remove('dc-editing')
      window.__uiEditing = false
    }
  }, [editing])

  // Auto-exit: tab hidden or Escape. The drag engine's capture-phase Escape
  // handler stops propagation while a drag is active, so Escape mid-drag only
  // cancels the drag — this bubble-phase listener never sees it.
  useEffect(() => {
    if (!editing) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setEditing(false)
    }
    const onKeyDown = e => {
      if (e.key === 'Escape') setEditing(false)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [editing])

  // Mode can change on another device — re-read after remote sync applies.
  useEffect(() => {
    const onSyncApplied = () => {
      const mode = getLayoutMode()
      setLayoutModeState(prev => (prev === mode ? prev : mode))
    }
    window.addEventListener('sync-applied', onSyncApplied)
    return () => window.removeEventListener('sync-applied', onSyncApplied)
  }, [])

  const value = useMemo(
    () => ({ editing, startEditing, stopEditing, layoutMode, setLayoutMode }),
    [editing, startEditing, stopEditing, layoutMode, setLayoutMode]
  )

  return <UIEditContext.Provider value={value}>{children}</UIEditContext.Provider>
}
