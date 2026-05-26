import { useState, useCallback } from 'react'
import Sidebar from './Sidebar.jsx'
import BottomNav from './BottomNav.jsx'
import { useSyncStatus } from '../contexts/SyncContext.jsx'

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

  return (
    <>
      <Sidebar />
      <main className="main-content">
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
