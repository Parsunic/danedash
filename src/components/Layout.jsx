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
    const onConnect    = () => { setGfitConnected(true);  setGfitLastSync_(getGfitLastSync()) }
    const onDisconnect = () => setGfitConnected(false)
    const onStatus     = (e) => { if (e.detail?.lastSync) setGfitLastSync_(e.detail.lastSync) }
    window.addEventListener('gfit-connected',    onConnect)
    window.addEventListener('gfit-disconnected', onDisconnect)
    window.addEventListener('gfit-sync-status',  onStatus)
    return () => {
      window.removeEventListener('gfit-connected',    onConnect)
      window.removeEventListener('gfit-disconnected', onDisconnect)
      window.removeEventListener('gfit-sync-status',  onStatus)
    }
  }, [])

  const save = useCallback(() => {
    setAnthropicKey(anthropicKey)
    setNotionKey(notionKey)
    setClientId(gcalClientId)
    setClientSecret(gcalClientSecret)
    onClose()
  }, [anthropicKey, notionKey, gcalClientId, gcalClientSecret, onClose])

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

  const handleGfitConnect = useCallback(() => {
    initiateGoogleFitOAuth()
  }, [])

  const handleGfitDisconnect = useCallback(() => {
    clearGfitTokens()
    setGfitConnected(false)
    window.dispatchEvent(new Event('gfit-disconnected'))
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
          <p className="settings-section-title">Google Health</p>

          <p className="settings-hint" style={{ marginBottom: 10 }}>
            Uses the same OAuth client as Google Calendar above. Configure the Client ID &amp; Secret there first, then connect below.
            In Google Cloud Console, enable the <strong>Fitness API</strong> and add these scopes:
            <code style={{ display: 'block', fontSize: 9.5, background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '5px 8px', marginTop: 5, lineHeight: 1.8, wordBreak: 'break-all' }}>
              fitness.activity.read · fitness.heart_rate.read · fitness.sleep.read
            </code>
          </p>

          <div className="gcal-status-row">
            {gfitConnected ? (
              <>
                <span className="gcal-status-text connected">Connected</span>
                <button className="settings-eye" onClick={handleGfitDisconnect}>Disconnect</button>
              </>
            ) : (
              <>
                <span className="gcal-status-text">Not connected</span>
                <button
                  className="gcal-connect-btn"
                  onClick={handleGfitConnect}
                  disabled={!getClientId().trim()}
                  title={!getClientId().trim() ? 'Enter Google OAuth credentials above first' : ''}
                >
                  Connect Google Health
                </button>
              </>
            )}
          </div>
          {gfitConnected && gfitLastSync && (
            <p className="settings-hint" style={{ marginTop: 4 }}>
              Last synced: {new Date(gfitLastSync).toLocaleString()}
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
        <div key={location.key} className="page-wrap page-enter">
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
