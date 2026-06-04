import { useState, useEffect, useCallback } from 'react'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import { isGfitConnected, getGfitLastSync } from '../../lib/api/googlefit.js'
import { syncTodayIfStale, syncGfitData, fetchHealthHistory } from './googleFitSync.js'

// ── Utilities ──

function relativeTime(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)      return 'just now'
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function sparklinePoints(values, min, max, w, h, pad = 4) {
  const range = max - min || 1
  return values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function sparklineArea(values, min, max, w, h, pad = 4) {
  const pts = sparklinePoints(values, min, max, w, h, pad).split(' ')
  const [firstX] = pts[0].split(',')
  const [lastX]  = pts[pts.length - 1].split(',')
  return `M${pts.join(' L')} L${lastX},${h - pad} L${firstX},${h - pad} Z`
}

// ── Hero stat card ──

function HeroCard({ label, value, unit, gradient, micro }) {
  const glows = {
    purple: 'radial-gradient(ellipse at 10% 90%, rgba(139,92,246,0.45) 0%, transparent 60%)',
    green:  'radial-gradient(ellipse at 90% 10%, rgba(107,227,164,0.35) 0%, transparent 60%)',
    orange: 'radial-gradient(ellipse at 90% 90%, rgba(249,115,22,0.40) 0%, transparent 60%)',
    amber:  'radial-gradient(ellipse at 10% 10%, rgba(232,160,32,0.38) 0%, transparent 60%)',
  }
  const hasValue = value != null
  return (
    <div className="health-stat-card">
      <div className="health-stat-glow" style={{ background: glows[gradient] ?? glows.amber }} />
      <div className="health-stat-label">{label}</div>
      <div className="health-stat-value" style={{ color: hasValue ? 'var(--text-primary)' : 'rgba(250,250,250,0.18)' }}>
        {hasValue ? value : '—'}
        {hasValue && unit && <span className="health-stat-unit">{unit}</span>}
      </div>
      {micro && <div className="health-stat-micro">{micro}</div>}
    </div>
  )
}

// ── Sleep card ──

function SleepCard({ today }) {
  const stages    = today?.sleep_stages
  const total     = stages ? (stages.deep + stages.light + stages.rem + stages.wake) : 0
  const asleepMin = stages ? (stages.deep + stages.light + stages.rem) : 0
  const h = Math.floor(asleepMin / 60)
  const m = asleepMin % 60

  return (
    <div className="health-card">
      <div className="health-card-header">
        <span className="health-card-label">Sleep</span>
        {stages && total > 0 && <span className="health-card-value">{h}h {m}m</span>}
      </div>

      {stages && total > 0 ? (
        <>
          <div className="sleep-stages-bar">
            {stages.deep  > 0 && <div className="sleep-stage deep"  style={{ flex: stages.deep }}  title={`Deep: ${stages.deep}m`}  />}
            {stages.rem   > 0 && <div className="sleep-stage rem"   style={{ flex: stages.rem }}   title={`REM: ${stages.rem}m`}   />}
            {stages.light > 0 && <div className="sleep-stage light" style={{ flex: stages.light }} title={`Light: ${stages.light}m`} />}
            {stages.wake  > 0 && <div className="sleep-stage wake"  style={{ flex: stages.wake }}  title={`Awake: ${stages.wake}m`} />}
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

// ── Recovery section: HRV sparkline + recovery ring side by side ──

function RecoverySection({ today, history }) {
  const hrv   = today?.hrv
  const score = today?.sleep_score

  const W = 200, H = 58
  const hrvValues = history.map(d => d.hrv).filter(v => v != null)
  const hrvMin    = hrvValues.length ? Math.min(...hrvValues) : 0
  const hrvMax    = hrvValues.length ? Math.max(...hrvValues, hrvMin + 1) : 60

  const ringR    = 40
  const ringCirc = 2 * Math.PI * ringR
  const ringFill = ringCirc * ((score ?? 0) / 100)
  const ringColor = score == null ? 'rgba(255,255,255,0.12)'
    : score >= 80 ? '#6BE3A4'
    : score >= 60 ? '#E8A020' : '#FF6B6B'

  const microCopy = score == null ? 'Waiting for data…'
    : score >= 80 ? 'Green light. Go hard today.'
    : score >= 60 ? 'Take it steady.'
    : 'Recovery day. Rest is progress.'

  return (
    <div className="health-two-col">
      {/* HRV sparkline */}
      <div className="health-card" style={{ marginBottom: 0 }}>
        <div className="health-card-header">
          <span className="health-card-label">HRV Trend</span>
          {hrv != null && (
            <span className="health-card-value">
              {Math.round(hrv)}<span style={{ fontSize: 11, opacity: 0.45, marginLeft: 3 }}>ms</span>
            </span>
          )}
        </div>
        {hrvValues.length >= 2 ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 64, display: 'block' }}>
            <defs>
              <linearGradient id="hrv-line" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor="#6BE3A4" />
                <stop offset="100%" stopColor="#2dd4bf" />
              </linearGradient>
              <linearGradient id="hrv-fill" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stopColor="#6BE3A4" stopOpacity="0.20" />
                <stop offset="100%" stopColor="#6BE3A4" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={sparklineArea(hrvValues, hrvMin, hrvMax, W, H)} fill="url(#hrv-fill)" />
            <polyline
              points={sparklinePoints(hrvValues, hrvMin, hrvMax, W, H)}
              fill="none" stroke="url(#hrv-line)" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div className="health-empty" style={{ paddingTop: 8 }}>Syncing more days…</div>
        )}
      </div>

      {/* Recovery ring */}
      <div className="health-card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div className="health-card-header" style={{ width: '100%' }}>
          <span className="health-card-label">Recovery Score</span>
        </div>
        <svg width="106" height="106" viewBox="0 0 106 106" style={{ display: 'block' }}>
          <circle cx="53" cy="53" r={ringR} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
          <circle
            cx="53" cy="53" r={ringR}
            fill="none" stroke={ringColor} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${ringFill} ${ringCirc}`}
            transform="rotate(-90 53 53)"
            style={{ filter: score != null ? `drop-shadow(0 0 8px ${ringColor}55)` : 'none', transition: 'stroke-dasharray 0.8s ease' }}
          />
          <text x="53" y="48" textAnchor="middle" fill={score != null ? ringColor : 'rgba(250,250,250,0.2)'} fontSize="22" fontWeight="300" fontFamily="Plus Jakarta Sans, sans-serif">
            {score ?? '—'}
          </text>
          <text x="53" y="64" textAnchor="middle" fill="rgba(250,250,250,0.28)" fontSize="7" fontFamily="Geist Mono, monospace" letterSpacing="2">
            SCORE
          </text>
        </svg>
        <p className="health-micro-copy" style={{ textAlign: 'center', marginTop: 6, fontSize: 11 }}>{microCopy}</p>
      </div>
    </div>
  )
}

// ── Activity card ──

function ActivityCard({ today, history }) {
  const steps     = today?.steps
  const activeMin = today?.active_minutes
  const goal      = 10_000
  const pct       = steps != null ? Math.min(steps / goal, 1) : 0

  const allSteps  = history.map(d => d.steps ?? 0)
  const stepsMax  = Math.max(...allSteps, goal, 1)
  const todayDate = todayStr()

  const dayLabels = history.map(d => {
    const dt = new Date(d.date + 'T12:00:00')
    return dt.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1)
  })

  const microCopy = steps == null   ? 'Waiting for step data…'
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
        <div className="health-stat-value" style={{ fontSize: 32, color: steps != null ? 'var(--text-primary)' : 'rgba(250,250,250,0.18)' }}>
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

      {allSteps.some(v => v > 0) && (
        <div style={{ marginTop: 20 }}>
          <div className="health-bars">
            {allSteps.map((v, i) => (
              <div key={i} className="health-bar-col">
                <div
                  className={`health-bar${history[i]?.date === todayDate ? ' today' : ''}`}
                  style={{ height: `${Math.max(Math.round((v / stepsMax) * 100), v > 0 ? 4 : 0)}%` }}
                  title={`${v.toLocaleString()} steps`}
                />
              </div>
            ))}
          </div>
          <div className="health-bar-labels">
            {dayLabels.map((d, i) => (
              <div key={i} className="health-bar-col">
                <span className="health-bar-date" style={{ opacity: history[i]?.date === todayDate ? 1 : 0.5 }}>{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="health-micro-copy" style={{ marginTop: 14 }}>{microCopy}</p>
    </div>
  )
}

// ── Main Health page ──

export default function Health() {
  const [history,    setHistory]    = useState([])
  const [syncStatus, setSyncStatus] = useState(null)
  const [lastSync,   setLastSync]   = useState(() => getFitbitLastSync())
  const [syncing,    setSyncing]    = useState(false)
  const [connected,  setConnected]  = useState(() => isFitbitConnected())

  const today = history.find(d => d.date === todayStr()) ?? null

  const loadHistory = useCallback(async () => {
    const data = await fetchHealthHistory(7)
    setHistory(data)
  }, [])

  useEffect(() => {
    loadHistory()
    if (connected) syncTodayIfStale()
  }, [connected, loadHistory])

  useEffect(() => {
    const onStatus = (e) => {
      setSyncStatus(e.detail.status)
      if (e.detail.lastSync) { setLastSync(e.detail.lastSync); loadHistory() }
    }
    const onConnect    = () => { setConnected(true);  syncTodayIfStale() }
    const onDisconnect = () => setConnected(false)

    window.addEventListener('fitbit-sync-status',  onStatus)
    window.addEventListener('fitbit-connected',    onConnect)
    window.addEventListener('fitbit-disconnected', onDisconnect)
    return () => {
      window.removeEventListener('fitbit-sync-status',  onStatus)
      window.removeEventListener('fitbit-connected',    onConnect)
      window.removeEventListener('fitbit-disconnected', onDisconnect)
    }
  }, [loadHistory])

  const handleSync = useCallback(async () => {
    if (syncing || syncStatus === 'syncing') return
    setSyncing(true)
    await syncFitbitData()
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
          <div className="health-subtitle">
            {lastSync
              ? `Synced ${relativeTime(lastSync)}`
              : connected ? 'Syncing…' : 'Connect Fitbit in Settings to sync'}
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
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ display: 'block', transition: 'transform 0.6s', transform: syncing ? 'rotate(360deg)' : 'none' }}>
                <path d="M13 7.5a5.5 5.5 0 1 1-1.1-3.3M13 2v3.5H9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          {syncStatus && (
            <div className="fitbit-sync-pill" data-status={syncStatus}>
              <span className="fitbit-sync-dot" />
              <span>{syncStatus}</span>
            </div>
          )}
        </div>
      </div>

      {/* Connect banner when not linked */}
      {!connected && (
        <div className="health-connect-banner">
          <div className="health-connect-title">Connect Fitbit</div>
          <div className="health-connect-hint">
            Sync sleep stages, HRV, heart rate, and daily steps automatically.
            Enter your Fitbit Client ID in Settings, then tap Connect.
          </div>
          <button className="health-connect-btn" onClick={() => window.dispatchEvent(new Event('open-settings'))}>
            Open Settings
          </button>
        </div>
      )}

      {/* Hero stats row */}
      <div className="health-hero-grid">
        <HeroCard
          label="Sleep Score" gradient="purple"
          value={today?.sleep_score}
          micro={today?.sleep_score != null
            ? today.sleep_score >= 80 ? 'Excellent'
            : today.sleep_score >= 60 ? 'Fair' : 'Poor'
            : null}
        />
        <HeroCard
          label="HRV" gradient="green" unit="ms"
          value={today?.hrv != null ? Math.round(today.hrv) : null}
        />
        <HeroCard label="Resting HR" gradient="orange" unit="bpm" value={today?.resting_hr} />
        <HeroCard
          label="Steps" gradient="amber"
          value={today?.steps != null ? today.steps.toLocaleString() : null}
        />
      </div>

      <SleepCard today={today} />

      <div className="health-recovery-row">
        <RecoverySection today={today} history={history} />
      </div>

      <ActivityCard today={today} history={history} />
    </div>
  )
}
