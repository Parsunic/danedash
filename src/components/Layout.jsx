import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import BottomNav from './BottomNav.jsx'
import { useSyncStatus } from '../contexts/SyncContext.jsx'
import { storeSet, storeGet } from '../lib/storage.js'
import { modules } from '../App.jsx'
import { resolveNavOrder, saveNavOrder, NAV_ORDER_KEY, useNavModules } from '../lib/navOrder.js'
import { getAnthropicKey, setAnthropicKey } from '../lib/api/anthropic.js'
import { isAudioEnabled, setAudioEnabled } from '../lib/audio.js'
import { getNotionKey, setNotionKey } from '../lib/api/notion.js'
import {
  getClientId, setClientId, getClientSecret, setClientSecret,
  getUserEmail, clearTokens, isConnected,
} from '../lib/api/gcalendar.js'
import { isGfitConnected, clearGfitTokens, getGfitLastSync } from '../lib/api/googlefit.js'
import { initiateGoogleOAuth } from '../modules/calendar/googleSync.js'
import { initiateGoogleFitOAuth } from '../modules/health/googleFitSync.js'
import { downloadBackup, restoreBackup } from '../lib/backup.js'

function SettingsModal({ onClose }) {
  const [anthropicKey, setAnthropicKeyState] = useState(() => getAnthropicKey())
  const [notionKey, setNotionKeyState]       = useState(() => getNotionKey())
  const [gcalClientId, setGcalClientIdState]     = useState(() => getClientId())
  const [gcalClientSecret, setGcalClientSecretSt] = useState(() => getClientSecret())
  const [gcalEmail, setGcalEmail]                = useState(() => getUserEmail())
  const [gcalConnected, setGcalConnected]        = useState(() => isConnected())
  const [gfitConnected, setGfitConnected] = useState(() => isGfitConnected())
  const [gfitLastSync,  setGfitLastSync_] = useState(() => getGfitLastSync())
  const [audioEnabled, setAudioEnabledState]      = useState(() => isAudioEnabled())
  const [gymAutoFinish, setGymAutoFinish]        = useState(() => {
    try { return (JSON.parse(localStorage.getItem('gym_settings')) || {}).autoFinish === true } catch { return false }
  })
  const [weightUnit, setWeightUnit] = useState(() => {
    try { return (JSON.parse(localStorage.getItem('gym_settings')) || {}).weightUnit || 'lbs' } catch { return 'lbs' }
  })
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

  // Card-layout mode. Draft is local until Save; persisting goes through the
  // UIEdit context so provider state and layouts_v1 stay in lockstep (its
  // setLayoutMode is the layoutStore storeSet — user gesture only).
  const { layoutMode, setLayoutMode, startEditing } = useUIEdit()
  const [layoutModeDraft, setLayoutModeDraft] = useState(layoutMode)

  // Navigation reorder draft — local until Save. Seeded from the reconciled
  // stored value (never writes on read). Arrows swap within order; eye toggles
  // hidden; reset restores the App.jsx default order with nothing hidden.
  const [navDraft, setNavDraft] = useState(() => resolveNavOrder(storeGet(NAV_ORDER_KEY), modules))
  const navMove = (idx, dir) => setNavDraft(d => {
    const j = idx + dir
    if (j < 0 || j >= d.order.length) return d
    const order = [...d.order]
    ;[order[idx], order[j]] = [order[j], order[idx]]
    return { ...d, order }
  })
  const navToggleHide = (path) => setNavDraft(d => {
    if (path === '/') return d
    const hidden = d.hidden.includes(path) ? d.hidden.filter(p => p !== path) : [...d.hidden, path]
    return { ...d, hidden }
  })
  const navReset = () => setNavDraft({ order: modules.map(m => m.path), hidden: [] })
  const navHiddenSet = new Set(navDraft.hidden)
  const navOrdered = navDraft.order.map(p => modules.find(m => m.path === p)).filter(Boolean)
  const navVisible = navOrdered.filter(m => !navHiddenSet.has(m.path))

  const save = useCallback(() => {
    setAnthropicKey(anthropicKey)
    setNotionKey(notionKey)
    setClientId(gcalClientId)
    setClientSecret(gcalClientSecret)
    setAudioEnabled(audioEnabled)
    const gymSettings = JSON.parse(localStorage.getItem('gym_settings') || '{}')
    gymSettings.autoFinish = gymAutoFinish
    gymSettings.weightUnit = weightUnit
    storeSet('gym_settings', gymSettings)
    // Dirty check — setLayoutMode does a storeSet, so only fire on a real change.
    if (layoutModeDraft !== layoutMode) setLayoutMode(layoutModeDraft)
    // Nav order — saveNavOrder does a storeSet, so only fire when the draft
    // actually differs from the reconciled stored value (compare canonical forms).
    const storedNav = resolveNavOrder(storeGet(NAV_ORDER_KEY), modules)
    if (JSON.stringify(storedNav) !== JSON.stringify(navDraft)) saveNavOrder(navDraft)
    onClose()
  }, [anthropicKey, notionKey, gcalClientId, gcalClientSecret, audioEnabled, gymAutoFinish, weightUnit, layoutModeDraft, layoutMode, setLayoutMode, navDraft, onClose])

  const handleEditLayout = useCallback(() => {
    save() // persist pending settings (also closes the modal)
    // Editing implies manual — explicit user gesture, storeSet is correct.
    if (layoutModeDraft !== 'manual') setLayoutMode('manual')
    startEditing()
  }, [save, layoutModeDraft, setLayoutMode, startEditing])

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
          <div className="settings-toggle-row">
            <div>
              <span className="settings-label" style={{ margin: 0 }}>Sound Effects</span>
              <p className="settings-hint" style={{ marginTop: 4 }}>Ding when all tasks are completed.</p>
            </div>
            <button
              className={audioEnabled ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: '0.75rem', padding: '5px 16px', flexShrink: 0 }}
              onClick={() => setAudioEnabledState(v => !v)}
            >
              {audioEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className="settings-toggle-row" style={{ marginTop: 12 }}>
            <div>
              <span className="settings-label" style={{ margin: 0 }}>Auto-finish Workout</span>
              <p className="settings-hint" style={{ marginTop: 4 }}>Automatically finish the workout if it's been running for 3+ hours and nothing was logged in the last 30 minutes. Duration is recorded as the last logged set time.</p>
            </div>
            <button
              className={gymAutoFinish ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: '0.75rem', padding: '5px 16px', flexShrink: 0 }}
              onClick={() => setGymAutoFinish(v => !v)}
            >
              {gymAutoFinish ? 'On' : 'Off'}
            </button>
          </div>
          <div className="settings-toggle-row" style={{ marginTop: 12 }}>
            <div>
              <span className="settings-label" style={{ margin: 0 }}>Weight Unit</span>
              <p className="settings-hint" style={{ marginTop: 4 }}>Unit shown for weights in logs, history, and suggestions. Values are stored as-entered — switching units only changes the label.</p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                className={weightUnit === 'lbs' ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: '0.75rem', padding: '5px 14px' }}
                onClick={() => setWeightUnit('lbs')}
              >lbs</button>
              <button
                className={weightUnit === 'kg' ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: '0.75rem', padding: '5px 14px' }}
                onClick={() => setWeightUnit('kg')}
              >kg</button>
            </div>
          </div>
          <div className="settings-section-divider" />
          <p className="settings-section-title">Customize</p>
          <div className="settings-toggle-row">
            <div>
              <span className="settings-label" style={{ margin: 0 }}>Layout</span>
              <p className="settings-hint" style={{ marginTop: 4 }}>Auto arranges cards to fit your screen. Manual keeps them where you put them.</p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                className={layoutModeDraft === 'auto' ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: '0.75rem', padding: '5px 14px' }}
                onClick={() => setLayoutModeDraft('auto')}
              >Auto</button>
              <button
                className={layoutModeDraft === 'manual' ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: '0.75rem', padding: '5px 14px' }}
                onClick={() => setLayoutModeDraft('manual')}
              >Manual</button>
            </div>
          </div>
          <div className="settings-toggle-row" style={{ marginTop: 12 }}>
            <div>
              <span className="settings-label" style={{ margin: 0 }}>Edit Layout</span>
              <p className="settings-hint" style={{ marginTop: 4 }}>Move and resize cards on any page. A Done button follows you.</p>
            </div>
            <button
              className="btn-secondary"
              style={{ fontSize: '0.75rem', padding: '5px 16px', flexShrink: 0 }}
              onClick={handleEditLayout}
            >Edit Layout</button>
          </div>
          <p className="settings-section-title" style={{ marginTop: 18 }}>Navigation</p>
          <p className="settings-hint" style={{ marginTop: 0 }}>Reorder tabs. Hidden tabs leave your phone bar but stay in the sidebar.</p>
          <div className="setnav-list">
            {navOrdered.map((m, i) => {
              const hidden = navHiddenSet.has(m.path)
              const locked = m.path === '/'
              // Hiding a currently-visible tab is blocked when it would drop below 2.
              const eyeDisabled = locked || (!hidden && navVisible.length <= 2)
              return (
                <div key={m.path} className={`setnav-row${hidden ? ' is-hidden' : ''}`}>
                  <span className="setnav-icon">{m.icon}</span>
                  <span className="setnav-label">{m.label}</span>
                  <div className="setnav-actions">
                    <button
                      className="setnav-btn"
                      onClick={() => navToggleHide(m.path)}
                      disabled={eyeDisabled}
                      aria-label={hidden ? 'Show tab' : 'Hide tab'}
                      title={locked ? 'Dashboard is always shown' : hidden ? 'Show on phone bar' : 'Hide from phone bar'}
                    >{hidden ? '🙈' : '👁'}</button>
                    <button
                      className="setnav-btn"
                      onClick={() => navMove(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                    >↑</button>
                    <button
                      className="setnav-btn"
                      onClick={() => navMove(i, 1)}
                      disabled={i === navOrdered.length - 1}
                      aria-label="Move down"
                    >↓</button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="setnav-preview">
            {navVisible.map(m => (
              <span key={m.path} className="setnav-preview-icon">{m.icon}</span>
            ))}
          </div>
          <p className="setnav-hint">Your phone bar — {navVisible.length} tabs.</p>
          <button
            className="btn-ghost"
            style={{ fontSize: '0.75rem', padding: '5px 14px', marginTop: 8 }}
            onClick={navReset}
          >Reset to default</button>
          <div className="settings-section-divider" />
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
            In Google Cloud Console, enable the <strong>Google Health API</strong> and add these scopes:
            <code style={{ display: 'block', fontSize: 9.5, background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '5px 8px', marginTop: 5, lineHeight: 1.8, wordBreak: 'break-all' }}>
              googlehealth.activity_and_fitness.readonly · googlehealth.health_metrics_and_measurements.readonly · googlehealth.sleep.readonly
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

import { useUIEdit } from '../contexts/UIEditContext.jsx'

export default function Layout({ children }) {
  const { editing, stopEditing } = useUIEdit()
  const [showSettings, setShowSettings] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const mainRef = useRef(null)
  const locationRef = useRef(location.pathname)
  // Swipe sequence follows the customized bottom-bar order. Held in a ref so the
  // touch listeners (bound once) read the latest list without re-binding on nav changes.
  const { mobileVisible } = useNavModules()
  const navListRef = useRef(mobileVisible)
  navListRef.current = mobileVisible

  useEffect(() => { locationRef.current = location.pathname }, [location.pathname])

  useEffect(() => {
    const handler = () => setShowSettings(true)
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    let startX = null, startY = null

    const onTouchStart = (e) => {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }

    const onTouchMove = (e) => {
      if (startX === null || window.__swipeDisabled) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        e.preventDefault()
      }
    }

    const onTouchEnd = (e) => {
      if (startX === null) return
      const dx = e.changedTouches[0].clientX - startX
      const dy = e.changedTouches[0].clientY - startY
      startX = null; startY = null
      if (window.__swipeDisabled) return
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return
      const list = navListRef.current
      const idx = list.findIndex(m => m.path === locationRef.current)
      if (idx === -1) return // current tab isn't in the phone bar → swipe does nothing
      if (dx < 0 && idx < list.length - 1) navigate(list[idx + 1].path)
      else if (dx > 0 && idx > 0) navigate(list[idx - 1].path)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [navigate])

  return (
    <>
      <Sidebar />
      <main
        ref={mainRef}
        className="main-content"
        style={{ touchAction: 'pan-y' }}
      >
        <div key={location.key} className="page-wrap page-enter">
          {children}
        </div>
      </main>
      <BottomNav />
      {editing && (
        <button className="dc-done-pill" onClick={stopEditing}>Done</button>
      )}
      <SyncStatus onSettings={() => setShowSettings(true)} />
      <GCalSyncStatus />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}
