import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import BottomNav from './BottomNav.jsx'
import { useSyncStatus } from '../contexts/SyncContext.jsx'
import { modules } from '../App.jsx'
import { getAnthropicKey, setAnthropicKey } from '../lib/api/anthropic.js'
import { getNotionKey, setNotionKey } from '../lib/api/notion.js'
import {
  getClientId, setClientId, getUserEmail, clearTokens, isConnected,
} from '../lib/api/gcalendar.js'
import { initiateGoogleOAuth } from '../modules/calendar/googleSync.js'

function SettingsModal({ onClose }) {
  const [anthropicKey, setAnthropicKeyState] = useState(() => getAnthropicKey())
  const [notionKey, setNotionKeyState]       = useState(() => getNotionKey())
  const [showAnthropic, setShowAnthropic]    = useState(false)
  const [showNotion, setShowNotion]          = useState(false)

  const save = useCallback(() => {
    setAnthropicKey(anthropicKey)
    setNotionKey(notionKey)
    onClose()
  }, [anthropicKey, notionKey, onClose])

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
              type={showAnthropic ? 'text' : 'password'}
              value={anthropicKey}
              onChange={e => setAnthropicKeyState(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
              spellCheck={false}
            />
            <button className="settings-eye" onClick={() => setShowAnthropic(v => !v)} aria-label={showAnthropic ? 'Hide' : 'Show'}>
              {showAnthropic ? '🙈' : '👁'}
            </button>
          </div>
          <p className="settings-hint">Used for AI goal polish. Stored in your browser only.</p>

          <label className="settings-label" style={{ marginTop: 16 }}>Notion API Key</label>
          <div className="settings-input-row">
            <input
              className="settings-input"
              type={showNotion ? 'text' : 'password'}
              value={notionKey}
              onChange={e => setNotionKeyState(e.target.value)}
              placeholder="secret_..."
              autoComplete="off"
              spellCheck={false}
            />
            <button className="settings-eye" onClick={() => setShowNotion(v => !v)} aria-label={showNotion ? 'Hide' : 'Show'}>
              {showNotion ? '🙈' : '👁'}
            </button>
          </div>
          <p className="settings-hint">Stored in your browser only.</p>
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
