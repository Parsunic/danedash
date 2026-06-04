import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import BottomNav from './BottomNav.jsx'
import { useSyncStatus } from '../contexts/SyncContext.jsx'
import { modules } from '../App.jsx'
import { getAnthropicKey, setAnthropicKey } from '../lib/api/anthropic.js'
import { getNotionKey, setNotionKey } from '../lib/api/notion.js'
import {
  getClientId, setClientId, getClientSecret, setClientSecret,
  getUserEmail, clearTokens, isConnected,
} from '../lib/api/gcalendar.js'
import { isGfitConnected, clearGfitTokens, getGfitLastSync } from '../lib/api/googlefit.js'
import { getClientId } from '../lib/api/gcalendar.js'
import { initiateGoogleOAuth } from '../modules/calendar/googleSync.js'
import { initiateGoogleFitOAuth } from '../modules/health/googleFitSync.js'

function SettingsModal({ onClose }) {
  const [anthropicKey, setAnthropicKeyState] = useState(() => getAnthropicKey())
  const [notionKey, setNotionKeyState]       = useState(() => getNotionKey())
  const [gcalClientId, setGcalClientIdState]     = useState(() => getClientId())
  const [gcalClientSecret, setGcalClientSecretSt] = useState(() => getClientSecret())
  const [gcalEmail, setGcalEmail]                = useState(() => getUserEmail())
  const [gcalConnected, setGcalConnected]        = useState(() => isConnected())
  const [gfitConnected, setGfitConnected] = useState(() => isGfitConnected())
  const [gfitLastSync,  setGfitLastSync_] = useState(() => getGfitLastSync())
  const [showAnthropic, setShowAnthropic]        = useState(false)
  const [showNotion, setShowNotion]              = useState(false)
  const [showGcalSecret, setShowGcalSecret]      = useState(false)

  useEffect(() => {
    const onConnect    = () => { setFitbitConnected(true);  setFitbitLastSync_(getFitbitLastSync()) }
    const onDisconnect = () => setFitbitConnected(false)
    const onStatus     = (e) => { if (e.detail?.lastSync) setFitbitLastSync_(e.detail.lastSync) }
    window.addEventListener('fitbit-connected',    onConnect)
    window.addEventListener('fitbit-disconnected', onDisconnect)
    window.addEventListener('fitbit-sync-status',  onStatus)
    return () => {
      window.removeEventListener('fitbit-connected',    onConnect)
      window.removeEventListener('fitbit-disconnected', onDisconnect)
      window.removeEventListener('fitbit-sync-status',  onStatus)
    }
  }, [])

  const save = useCallback(() => {
    setAnthropicKey(anthropicKey)
    setNotionKey(notionKey)
    setClientId(gcalClientId)
    setClientSecret(gcalClientSecret)
    setFitbitClientId(fitbitClientId)
    onClose()
  }, [anthropicKey, notionKey, gcalClientId, gcalClientSecret, fitbitClientId, onClose])

  const handleDisconnect = useCallback(() => {
    clearTokens()
    setGcalConnected(false)
    setGcalEmail(null)
    window.dispatchEvent(new Event('gcal-disconnected'))
  }, [])

  const handleConnect = useCallback(() => {
    setClientId(gcalClientId)
    setClientSecret(gcalClientSecret)
    initiateGoogleOAuth()
  }, [gcalClientId, gcalClientSecret])

  const handleFitbitConnect = useCallback(() => {
    setFitbitClientId(fitbitClientId)
    initiateFitbitOAuth()
  }, [fitbitClientId])

  const handleFitbitDisconnect = useCallback(() => {
    clearFitbitTokens()
    setFitbitConnected(false)
    window.dispatchEvent(new Event('fitbit-disconnected'))
  }, [])

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

          <div className="settings-section-divider" />
          <p className="settings-section-title">Google Calendar</p>

          <label className="settings-label">OAuth Client ID</label>
          <div className="settings-input-row">
            <input
              className="settings-input"
              type="text"
              value={gcalClientId}
              onChange={e => setGcalClientIdState(e.target.value)}
              placeholder="xxxx.apps.googleusercontent.com"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="settings-hint">From Google Cloud Console → OAuth 2.0 Client IDs.</p>

          <label className="settings-label" style={{ marginTop: 12 }}>Client Secret</label>
          <div className="settings-input-row">
            <input
              className="settings-input"
              type={showGcalSecret ? 'text' : 'password'}
              value={gcalClientSecret}
              onChange={e => setGcalClientSecretSt(e.target.value)}
              placeholder="GOCSPX-..."
              autoComplete="off"
              spellCheck={false}
            />
            <button className="settings-eye" onClick={() => setShowGcalSecret(v => !v)} aria-label={showGcalSecret ? 'Hide' : 'Show'}>
              {showGcalSecret ? '🙈' : '👁'}
            </button>
          </div>
          <p className="settings-hint">Stored in your browser only.</p>

          <div className="gcal-status-row">
            {gcalConnected ? (
              <>
                <span className="gcal-status-text connected">Connected as {gcalEmail || 'Google account'}</span>
                <button className="settings-eye" onClick={handleDisconnect}>Disconnect</button>
              </>
            ) : (
              <>
                <span className="gcal-status-text">Not connected</span>
                <button
                  className="gcal-connect-btn"
                  onClick={handleConnect}
                  disabled={!gcalClientId.trim() || !gcalClientSecret.trim()}
                >
                  Connect
                </button>
              </>
            )}
          </div>

          <div className="settings-section-divider" />
          <p className="settings-section-title">Fitbit</p>

          <label className="settings-label">Client ID</label>
          <div className="settings-input-row">
            <input
              className="settings-input"
              type="text"
              value={fitbitClientId}
              onChange={e => setFitbitClientIdState(e.target.value)}
              placeholder="22XXXXX"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="settings-hint">From dev.fitbit.com → Register an App. Set redirect URI to <code style={{ fontSize: 10, background: 'rgba(255,255,255,0.07)', borderRadius: 3, padding: '1px 4px' }}>{window.location.origin}</code></p>

          <div className="gcal-status-row">
            {fitbitConnected ? (
              <>
                <span className="gcal-status-text connected">Connected</span>
                <button className="settings-eye" onClick={handleFitbitDisconnect}>Disconnect</button>
              </>
            ) : (
              <>
                <span className="gcal-status-text">Not connected</span>
                <button
                  className="gcal-connect-btn"
                  onClick={handleFitbitConnect}
                  disabled={!fitbitClientId.trim()}
                >
                  Connect Fitbit
                </button>
              </>
            )}
          </div>
          {fitbitConnected && fitbitLastSync && (
            <p className="settings-hint" style={{ marginTop: 4 }}>
              Last synced: {new Date(fitbitLastSync).toLocaleString()}
            </p>
          )}
        </div>
        <div className="settings-footer">
          <button className="settings-save" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

function SyncStatus({ onSettings }) {
  const { status, isOffline } = useSyncStatus()
  const label = status === 'syncing' ? 'Syncing…' : status === 'synced' ? 'Synced' : status === 'error' ? 'Sync error' : 'Offline'
  return (
    <>
      {isOffline && (
        <div className="offline-banner">
          Offline — showing cached data
        </div>
      )}
      <div className="sync-status" data-status={status}>
        <span className="sync-dot" />
        <span className="sync-label">{label}</span>
        <button className="sync-settings-btn" onClick={onSettings} aria-label="Settings">⚙</button>
      </div>
    </>
  )
}

function GCalSyncStatus() {
  const [status, setStatus] = useState(() => isConnected() ? 'idle' : null)
  useEffect(() => {
    const onStatus = (e) => setStatus(e.detail.status)
    const onDisconnect = () => setStatus(null)
    window.addEventListener('gcal-sync-status', onStatus)
    window.addEventListener('gcal-disconnected', onDisconnect)
    return () => {
      window.removeEventListener('gcal-sync-status', onStatus)
      window.removeEventListener('gcal-disconnected', onDisconnect)
    }
  }, [])
  if (!status) return null
  const label = status === 'syncing' ? 'GCal…' : status === 'error' ? 'GCal error' : 'GCal'
  return (
    <div className="gcal-sync-status" data-status={status}>
      <span className="gcal-icon-g">G</span>
      <span className="sync-label">{label}</span>
    </div>
  )
}

export default function Layout({ children }) {
  const [showSettings, setShowSettings] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const touchStartX = useRef(null)
  const touchStartY = useRef(null)

  useEffect(() => {
    const handler = () => setShowSettings(true)
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

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
      <GCalSyncStatus />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}
