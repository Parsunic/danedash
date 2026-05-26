import { useState, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import BottomNav from './BottomNav.jsx'
import { useSyncStatus } from '../contexts/SyncContext.jsx'
import { modules } from '../App.jsx'

function SettingsModal({ onClose }) {
  const [key, setKey] = useState(() => localStorage.getItem('anthropic_api_key') || '')
  const [show, setShow] = useState(false)

  const save = useCallback(() => {
    if (key.trim()) localStorage.setItem('anthropic_api_key', key.trim())
    else localStorage.removeItem('anthropic_api_key')
    onClose()
  }, [key, onClose])

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="settings-body">
          <label className="settings-label">Anthropic API Key</label>
          <div className="settings-input-row">
            <input
              className="settings-input"
              type={show ? 'text' : 'password'}
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
              spellCheck={false}
            />
            <button className="settings-eye" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide' : 'Show'}>
              {show ? '🙈' : '👁'}
            </button>
          </div>
          <p className="settings-hint">Used for AI goal polish. Stored in your browser only.</p>
        </div>
        <div className="settings-footer">
          <button className="settings-save" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

function SyncStatus({ onSettings }) {
  const { status } = useSyncStatus()
  const label = status === 'syncing' ? 'Syncing…' : status === 'synced' ? 'Synced' : status === 'error' ? 'Sync error' : 'Offline'
  return (
    <div className="sync-status" data-status={status}>
      <span className="sync-dot" />
      <span className="sync-label">{label}</span>
      <button className="sync-settings-btn" onClick={onSettings} aria-label="Settings">⚙</button>
    </div>
  )
}

export default function Layout({ children }) {
  const [showSettings, setShowSettings] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const touchStartX = useRef(null)
  const touchStartY = useRef(null)

  const handleTouchStart = useCallback((e) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback((e) => {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    // Only fire if more horizontal than vertical and above threshold
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return
    const idx = modules.findIndex(m => m.path === location.pathname)
    if (dx < 0 && idx < modules.length - 1) navigate(modules[idx + 1].path)
    else if (dx > 0 && idx > 0) navigate(modules[idx - 1].path)
  }, [navigate, location.pathname])

  return (
    <>
      <Sidebar />
      <main
        className="main-content"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="page-wrap">
          {children}
        </div>
      </main>
      <BottomNav />
      <SyncStatus onSettings={() => setShowSettings(true)} />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}
