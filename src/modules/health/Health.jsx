import { useState, useEffect, useCallback, useRef } from 'react'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import { isGfitConnected, getGfitLastSync } from '../../lib/api/googlefit.js'
import { syncTodayIfStale, syncGfitData, fetchHealthHistory } from './googleFitSync.js'
import {
  SleepTrendChart, HRVTrendChart, RestingHRChart,
  SleepStagesChart, WeeklyActivityChart,
} from './HealthCharts.jsx'

// ── Utilities ──

function relativeTime(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)    return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Count-up hook ──

function useCountUp(target, duration = 700) {
  const [display, setDisplay] = useState(target == null ? null : 0)
  const rafRef = useRef(null)
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (target == null) { setDisplay(null); return }
    setDisplay(0)
    const start = performance.now()
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1)
      setDisplay(Math.round(t * target))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else setDisplay(target)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])
  return display
}

// ── Hero stat card ──

function HeroCard({ label, value, unit, gradient, micro, formatter }) {
  const numValue = typeof value === 'number' ? value : null
  const animated = useCountUp(numValue)
  const glows = {
    purple: 'radial-gradient(ellipse at 10% 90%, rgba(139,92,246,0.45) 0%, transparent 60%)',
    green:  'radial-gradient(ellipse at 90% 10%, rgba(107,227,164,0.35) 0%, transparent 60%)',
    orange: 'radial-gradient(ellipse at 90% 90%, rgba(249,115,22,0.40) 0%, transparent 60%)',
    amber:  'radial-gradient(ellipse at 10% 10%, rgba(232,160,32,0.38) 0%, transparent 60%)',
  }
  const hasValue = value != null
  const displayed = numValue != null && animated != null
    ? (formatter ? formatter(animated) : animated)
    : value
  return (
    <div className="health-stat-card">
      <div className="health-stat-glow" style={{ background: glows[gradient] ?? glows.amber }} />
      <div className="health-stat-label">{label}</div>
      <div className="health-stat-value" style={{ color: hasValue ? 'var(--text-primary)' : 'rgba(250,250,250,0.18)' }}>
        {hasValue ? displayed : '—'}
        {hasValue && unit && <span className="health-stat-unit">{unit}</span>}
      </div>
      {micro && <div className="health-stat-micro">{micro}</div>}
    </div>
  )
}

// ── Today's sleep breakdown ──

function SleepCard({ today }) {
  const stages    = today?.sleep_stages
  const total     = stages ? (stages.deep + stages.light + stages.rem + (stages.wake ?? 0)) : 0
  const asleepMin = stages ? (stages.deep + stages.light + stages.rem) : 0
  const h = Math.floor(asleepMin / 60)
  const m = asleepMin % 60

  return (
    <div className="health-card">
      <div className="health-card-header">
        <span className="health-card-label">Last Night</span>
        {stages && total > 0 && <span className="health-card-value">{h}h {m}m</span>}
      </div>

      {stages && total > 0 ? (
        <>
          <div className="sleep-stages-bar">
            {stages.deep  > 0 && <div className="sleep-stage deep"  style={{ flex: stages.deep }}  title={`Deep: ${stages.deep}m`}  />}
            {stages.rem   > 0 && <div className="sleep-stage rem"   style={{ flex: stages.rem }}   title={`REM: ${stages.rem}m`}   />}
            {stages.light > 0 && <div className="sleep-stage light" style={{ flex: stages.light }} title={`Light: ${stages.light}m`} />}
            {stages.wake  > 0 && <div className="sleep-stage wake"  style={{ flex: stages.wake }}  title={`Awake: ${stages.wake}m`}  />}
          </div>
          <div className="sleep-stages-legend">
            <span className="sleep-legend-item"><span className="sleep-dot deep"  />{stages.deep}m Deep</span>
            <span className="sleep-legend-item"><span className="sleep-dot rem"   />{stages.rem}m REM</span>
            <span className="sleep-legend-item"><span className="sleep-dot light" />{stages.light}m Light</span>
            <span className="sleep-legend-item"><span className="sleep-dot wake"  />{stages.wake}m Awake</span>
          </div>
          <p className="health-micro-copy">
            {stages.deep >= 90 ? "Deep sleep locked in. Body's doing the work." : "Chasing that deep sleep. You're getting there."}
          </p>
        </>
      ) : (
        <div className="health-empty">No sleep data for today yet</div>
      )}
    </div>
  )
}

// ── Today's activity hero ──

function ActivityHero({ today }) {
  const steps     = today?.steps
  const activeMin = today?.active_minutes
  const goal      = 10_000
  const pct       = steps != null ? Math.min(steps / goal, 1) : 0

  const microCopy = steps == null    ? 'Waiting for step data…'
    : steps >= 10_000 ? "Hit the goal. Legs don't lie."
    : steps >= 7_000  ? 'Almost there. One more loop.'
    : steps >= 5_000  ? 'Halfway. Keep it moving.'
    : 'Time to move.'

  return (
    <div className="health-card">
      <div className="health-card-header">
        <span className="health-card-label">Activity</span>
        {activeMin != null && <span className="health-card-value">{activeMin}m active</span>}
      </div>
      <div className="health-steps-hero">
        <div
          className="health-stat-value"
          style={{ fontSize: 32, color: steps != null ? 'var(--text-primary)' : 'rgba(250,250,250,0.18)' }}
        >
          {steps != null ? steps.toLocaleString() : '—'}
        </div>
        <div className="health-stat-micro" style={{ marginTop: 3 }}>steps today · goal {goal.toLocaleString()}</div>
      </div>
      <div className="health-progress-track">
        <div
          className="health-progress-fill"
          style={{ width: `${pct * 100}%`, background: pct >= 1 ? '#6BE3A4' : 'linear-gradient(90deg, var(--accent), #f97316)' }}
        />
      </div>
      <p className="health-micro-copy" style={{ marginTop: 14 }}>{microCopy}</p>
    </div>
  )
}

// ── Main Health page ──

export default function Health() {
  const [history,    setHistory]    = useState([])
  const [syncStatus, setSyncStatus] = useState(null)
  const [lastSync,   setLastSync]   = useState(() => getGfitLastSync())
  const [syncing,    setSyncing]    = useState(false)
  const [connected,  setConnected]  = useState(() => isGfitConnected())
  const [syncError,  setSyncError]  = useState(() => localStorage.getItem('health_sync_error'))

  const today = history.find(d => d.date === todayStr()) ?? null

  const loadHistory = useCallback(async () => {
    const data = await fetchHealthHistory(30)
    setHistory(data)
  }, [])

  useEffect(() => {
    loadHistory()
    if (connected) syncTodayIfStale()
  }, [connected, loadHistory])

  useEffect(() => {
    const onStatus     = (e) => {
      setSyncStatus(e.detail.status)
      if (e.detail.lastSync) { setLastSync(e.detail.lastSync); loadHistory() }
      if (e.detail.status === 'error') setSyncError(localStorage.getItem('health_sync_error'))
      if (e.detail.status === 'synced') setSyncError(null)
    }
    const onConnect    = () => { setConnected(true); syncTodayIfStale() }
    const onDisconnect = () => setConnected(false)

    window.addEventListener('gfit-sync-status',  onStatus)
    window.addEventListener('gfit-connected',    onConnect)
    window.addEventListener('gfit-disconnected', onDisconnect)
    return () => {
      window.removeEventListener('gfit-sync-status',  onStatus)
      window.removeEventListener('gfit-connected',    onConnect)
      window.removeEventListener('gfit-disconnected', onDisconnect)
    }
  }, [loadHistory])

  const handleSync = useCallback(async () => {
    if (syncing || syncStatus === 'syncing') return
    setSyncing(true)
    await syncGfitData()
    await loadHistory()
    setSyncing(false)
  }, [syncing, syncStatus, loadHistory])

  return (
    <div className="health-page">
      <BackgroundBlob page="health" />

      {/* Header */}
      <div className="health-page-header">
        <div>
          <h1 className="health-title">Health</h1>
          <div className="page-subtitle">
            {lastSync
              ? `Synced ${relativeTime(lastSync)}`
              : connected ? 'Syncing…' : 'Connect Google Health in Settings to sync'}
          </div>
        </div>
        <div className="health-header-right">
          {connected && (
            <button
              className="health-sync-btn"
              onClick={handleSync}
              disabled={syncing || syncStatus === 'syncing'}
              aria-label="Sync now"
              title="Force sync"
            >
              <svg
                width="15" height="15" viewBox="0 0 15 15" fill="none"
                style={{ display: 'block', transition: 'transform 0.6s', transform: syncing ? 'rotate(360deg)' : 'none' }}
              >
                <path d="M13 7.5a5.5 5.5 0 1 1-1.1-3.3M13 2v3.5H9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {syncStatus && (
            <div className="gfit-sync-pill" data-status={syncStatus}>
              <span className="gfit-sync-dot" />
              <span>{syncStatus}</span>
            </div>
          )}
        </div>
      </div>

      {/* Connect banner */}
      {!connected && (
        <div className="health-connect-banner">
          <div className="health-connect-title">Connect Google Health</div>
          <div className="health-connect-hint">
            Sync sleep stages, HRV, heart rate, and daily steps from Google Health (Fitbit).
            Configure your Google OAuth credentials in Settings, then tap Connect.
          </div>
          <button className="btn-primary" onClick={() => window.dispatchEvent(new Event('open-settings'))}>
            Open Settings
          </button>
        </div>
      )}

      {/* Sync error banner */}
      {syncError && (
        <div className="health-error-banner">
          <span className="health-error-icon">⚠</span>
          <span className="health-error-msg">Sync failed: {syncError}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {syncError.includes('403') && (
              <button className="btn-ghost health-error-dismiss" onClick={() => window.dispatchEvent(new Event('open-settings'))}>
                Reconnect
              </button>
            )}
            <button className="btn-ghost health-error-dismiss" onClick={() => { localStorage.removeItem('health_sync_error'); setSyncError(null) }}>Dismiss</button>
          </div>
        </div>
      )}

      {/* Hero stats row */}
      <div className="health-hero-grid stagger-1">
        <HeroCard
          label="Sleep Score" gradient="purple"
          value={today?.sleep_score}
          micro={(() => {
            if (!today?.sleep_score) return null
            const s = today?.sleep_stages
            const asleepMin = s ? (s.deep + s.light + s.rem) : null
            const quality = today.sleep_score >= 80 ? 'Excellent' : today.sleep_score >= 60 ? 'Fair' : 'Poor'
            if (asleepMin == null) return quality
            return `${Math.floor(asleepMin / 60)}h ${asleepMin % 60}m · ${quality}`
          })()}
        />
        <HeroCard label="HRV"         gradient="green"  unit="ms"  value={today?.hrv != null ? Math.round(today.hrv) : null} />
        <HeroCard label="Resting HR"  gradient="orange" unit="bpm" value={today?.resting_hr} />
        <HeroCard
          label="Steps" gradient="amber"
          value={today?.steps ?? null}
          formatter={(v) => v.toLocaleString()}
        />
      </div>

      {/* Sleep section */}
      <div className="health-section-label stagger-2">Sleep</div>
      <SleepCard today={today} />
      <div className="health-chart-row stagger-3">
        <SleepTrendChart history={history} />
        <SleepStagesChart history={history} />
      </div>

      {/* Recovery section */}
      <div className="health-section-label stagger-4">Recovery</div>
      <div className="health-chart-row stagger-4">
        <HRVTrendChart history={history} />
        <RestingHRChart history={history} />
      </div>

      {/* Activity section */}
      <div className="health-section-label">Activity</div>
      <ActivityHero today={today} />
      <WeeklyActivityChart history={history} />
    </div>
  )
}
