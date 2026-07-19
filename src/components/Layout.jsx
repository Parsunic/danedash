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
import { getNotifPrefs, saveNotifPrefs, requestPermission } from '../lib/notifications.js'
import CommandPalette from './CommandPalette.jsx'
import { subscribeUpdate, applyUpdate } from '../lib/pwa.js'

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
    // Notification prefs — dirty-checked single storeSet (synced key). No boot write:
    // getNotifPrefs only reads, so an untouched section never writes on Save.
    if (JSON.stringify(getNotifPrefs()) !== JSON.stringify(notifPrefs)) saveNotifPrefs(notifPrefs)
    onClose()
  }, [anthropicKey, notionKey, gcalClientId, gcalClientSecret, audioEnabled, gymAutoFinish, weightUnit, layoutModeDraft, layoutMode, setLayoutMode, navDraft, notifPrefs, onClose])

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

  // Data backup & restore. Note is a { ok, msg } object shown inline under the buttons.
  const restoreInputRef = useRef(null)
  const [dataNote, setDataNote] = useState(null)

  const handleDownloadBackup = useCallback(() => {
    try {
      downloadBackup()
      setDataNote({ ok: true, msg: 'Backup downloaded.' })
    } catch {
      setDataNote({ ok: false, msg: 'Could not create backup.' })
    }
  }, [])

  const handleRestoreClick = useCallback(() => {
    restoreInputRef.current?.click()
  }, [])

  const handleRestoreFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked later
    if (!file) return
    if (!window.confirm('Replace all app data on this device with the backup? This cannot be undone.')) return
    try {
      const text = await file.text()
      const { count } = restoreBackup(text) // reloads on success
      setDataNote({ ok: true, msg: `Restored ${count} items. Reloading…` })
    } catch (err) {
      setDataNote({ ok: false, msg: err?.message || 'Restore failed.' })
    }
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
          <p className="settings-section-title">Data</p>
          <p className="settings-hint" style={{ marginTop: 0 }}>Your data, in your hands. API keys and tokens are not included.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              className="btn-secondary"
              style={{ fontSize: '0.75rem', padding: '6px 16px' }}
              onClick={handleDownloadBackup}
            >Download backup</button>
            <button
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '6px 16px' }}
              onClick={handleRestoreClick}
            >Restore…</button>
          </div>
          {dataNote && (
            <p className="settings-hint" style={{ marginTop: 8, color: dataNote.ok ? undefined : '#F0A0A0' }}>
              {dataNote.msg}
            </p>
          )}
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={handleRestoreFile}
          />

          <div className="settings-section-divider" />
          <p className="settings-section-title">Notifications</p>
          <div className="settings-toggle-row">
            <div>
              <span className="settings-label" style={{ margin: 0 }}>Enable notifications</span>
              <p className="settings-hint" style={{ marginTop: 4 }}>Reminders fire while the app is open or recently backgrounded.</p>
            </div>
            <button
              className={notifPrefs.master ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: '0.75rem', padding: '5px 16px', flexShrink: 0 }}
              onClick={handleToggleMaster}
            >{notifPrefs.master ? 'On' : 'Off'}</button>
          </div>
          {notifBlocked && (
            <p className="settings-hint" style={{ marginTop: 6, color: '#F0A0A0' }}>
              Notifications are blocked in your browser settings.
            </p>
          )}
          <div style={{ opacity: notifPrefs.master ? 1 : 0.4, pointerEvents: notifPrefs.master ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
            <div className="settings-toggle-row" style={{ marginTop: 12 }}>
              <div>
                <span className="settings-label" style={{ margin: 0 }}>Rest timer</span>
                <p className="settings-hint" style={{ marginTop: 4 }}>Buzz when a gym rest timer finishes.</p>
              </div>
              <button
                className={notifPrefs.restTimer ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: '0.75rem', padding: '5px 16px', flexShrink: 0 }}
                onClick={() => setNotifPrefs(p => ({ ...p, restTimer: !p.restTimer }))}
              >{notifPrefs.restTimer ? 'On' : 'Off'}</button>
            </div>
            <div className="settings-toggle-row" style={{ marginTop: 12 }}>
              <div>
                <span className="settings-label" style={{ margin: 0 }}>Event alerts</span>
                <p className="settings-hint" style={{ marginTop: 4 }}>A heads-up before calendar events start.</p>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <input
                  className="settings-input"
                  type="number"
                  min={1}
                  max={60}
                  value={notifPrefs.eventStart.minBefore}
                  onChange={e => {
                    const n = Math.max(1, Math.min(60, parseInt(e.target.value) || 1))
                    setNotifPrefs(p => ({ ...p, eventStart: { ...p.eventStart, minBefore: n } }))
                  }}
                  style={{ width: 54, textAlign: 'center' }}
                  aria-label="Minutes before event"
                />
                <span className="settings-hint" style={{ margin: 0 }}>min</span>
                <button
                  className={notifPrefs.eventStart.enabled ? 'btn-primary' : 'btn-secondary'}
                  style={{ fontSize: '0.75rem', padding: '5px 16px' }}
                  onClick={() => setNotifPrefs(p => ({ ...p, eventStart: { ...p.eventStart, enabled: !p.eventStart.enabled } }))}
                >{notifPrefs.eventStart.enabled ? 'On' : 'Off'}</button>
              </div>
            </div>
            <div className="settings-toggle-row" style={{ marginTop: 12 }}>
              <div>
                <span className="settings-label" style={{ margin: 0 }}>Journal nudge</span>
                <p className="settings-hint" style={{ marginTop: 4 }}>An evening reminder if you haven't written yet.</p>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <input
                  className="settings-input"
                  type="time"
                  value={notifPrefs.journalEvening.time}
                  onChange={e => setNotifPrefs(p => ({ ...p, journalEvening: { ...p.journalEvening, time: e.target.value || '21:00' } }))}
                  style={{ width: 108 }}
                  aria-label="Journal nudge time"
                />
                <button
                  className={notifPrefs.journalEvening.enabled ? 'btn-primary' : 'btn-secondary'}
                  style={{ fontSize: '0.75rem', padding: '5px 16px' }}
                  onClick={() => setNotifPrefs(p => ({ ...p, journalEvening: { ...p.journalEvening, enabled: !p.journalEvening.enabled } }))}
                >{notifPrefs.journalEvening.enabled ? 'On' : 'Off'}</button>
              </div>
            </div>
            <div className="settings-toggle-row" style={{ marginTop: 12 }}>
              <div>
                <span className="settings-label" style={{ margin: 0 }}>Habit summary</span>
                <p className="settings-hint" style={{ marginTop: 4 }}>A morning note of habits still open today.</p>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <input
                  className="settings-input"
                  type="time"
                  value={notifPrefs.habitMorning.time}
                  onChange={e => setNotifPrefs(p => ({ ...p, habitMorning: { ...p.habitMorning, time: e.target.value || '09:00' } }))}
                  style={{ width: 108 }}
                  aria-label="Habit summary time"
                />
                <button
                  className={notifPrefs.habitMorning.enabled ? 'btn-primary' : 'btn-secondary'}
                  style={{ fontSize: '0.75rem', padding: '5px 16px' }}
                  onClick={() => setNotifPrefs(p => ({ ...p, habitMorning: { ...p.habitMorning, enabled: !p.habitMorning.enabled } }))}
                >{notifPrefs.habitMorning.enabled ? 'On' : 'Off'}</button>
              </div>
            </div>
          </div>
          <p className="settings-hint" style={{ marginTop: 10 }}>On iPhone, install the app to your home screen for notifications.</p>

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
  const [cmdpOpen, setCmdpOpen] = useState(false)
  // PWA update pill: shown when a new service worker is waiting. Dismiss hides
  // it for the rest of the session (state resets on the next reload).
  const [updateReady, setUpdateReady] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)
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

  // Surface the "Update ready" pill when a new service worker is waiting.
  useEffect(() => subscribeUpdate(setUpdateReady), [])

  // Ctrl/Cmd+K toggles the command palette. Ignore the chord while typing in a
  // text field so it never hijacks in-page editing (per spec).
  useEffect(() => {
    const isEditable = (el) =>
      !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        if (isEditable(e.target)) return
        e.preventDefault()
        setCmdpOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
      {updateReady && !updateDismissed && (
        <div className="pwa-update-pill" role="status">
          <span className="pwa-update-label">Update ready</span>
          <button className="btn-primary" onClick={applyUpdate}>Refresh</button>
          <button
            className="pwa-update-dismiss"
            onClick={() => setUpdateDismissed(true)}
            aria-label="Dismiss update"
          >×</button>
        </div>
      )}
      {!editing && (
        <button
          className="cmdp-fab"
          onClick={() => setCmdpOpen(true)}
          aria-label="Open command palette"
          title="Quick add & search"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-3.2-3.2" />
          </svg>
        </button>
      )}
      <CommandPalette open={cmdpOpen} onClose={() => setCmdpOpen(false)} />
      <SyncStatus onSettings={() => setShowSettings(true)} />
      <GCalSyncStatus />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}
