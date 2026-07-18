import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import { useFlip, FlipTitle } from '../../components/FlipSwitch.jsx'
import { isGfitConnected, getGfitLastSync } from '../../lib/api/googlefit.js'
import { syncTodayIfStale, syncGfitData, fetchHealthHistory } from './googleFitSync.js'
import { SleepTrendChart, HRVTrendChart, RestingHRChart, SleepStagesChart } from './HealthCharts.jsx'
import { storeGet } from '../../lib/storage.js'
import { getAnthropicKey } from '../../lib/api/anthropic.js'
import { renderMarkdown } from '../../lib/renderMarkdown.jsx'
import CardGrid from '../../components/cards/CardGrid.jsx'
import { useUIEdit } from '../../contexts/UIEditContext.jsx'
import {
  buildHealthOverviewRegistry, HEALTH_OVERVIEW_ORDER,
  buildHealthTrendsRegistry, HEALTH_TRENDS_ORDER,
} from './healthCardRegistries.jsx'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANALYSIS_MODEL = 'claude-haiku-4-5-20251001'

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

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

// ── Derived metrics ──
// The readiness formula (sleep .4 / HRV .4 / RHR .2 vs 30-day baselines) lives
// in readinessUtils.js, shared with the verdict card, the readiness trend
// chart, and the dashboard Readiness widget — one source, numbers always agree.

function computeReadiness(today, history) {
  return readinessFromHistory(today, history)
}

function computeStress(today, history) {
  const r = computeReadiness(today, history)
  return r == null ? null : Math.max(0, Math.min(100, 100 - r))
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

// ── Stat Ring ──

function StatRing({ value, max = 100, label, sublabel, color = '#6BE3A4' }) {
  const animated = useCountUp(value)
  const SIZE = 118, SW = 9
  const r = (SIZE - SW * 2) / 2
  const C = 2 * Math.PI * r
  const pct = value != null ? Math.min(Math.max(value / max, 0), 1) : 0

  return (
    <div className="health-ring-card">
      <div style={{ position: 'relative', width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={SW} />
          {value != null && (
            <circle
              cx={SIZE / 2} cy={SIZE / 2} r={r}
              fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round"
              strokeDasharray={`${C * pct} ${C}`}
              style={{ transition: 'stroke-dasharray 0.85s ease-out' }}
            />
          )}
        </svg>
        <div className="health-ring-inner">
          <div className="health-ring-number" style={{ color: value != null ? 'var(--text-primary)' : 'rgba(255,255,255,0.18)' }}>
            {value != null ? animated : '—'}
          </div>
        </div>
      </div>
      <div className="health-ring-label">{label}</div>
      {sublabel && <div className="health-ring-sublabel" style={{ color }}>{sublabel}</div>}
    </div>
  )
}

// ── Stress Gauge ──

function StressGauge({ value }) {
  const animated = useCountUp(value)
  const CX = 100, CY = 96, R = 70, NEEDLE = 58

  const angleDeg = 180 - ((value ?? 50) / 100 * 180)
  const angleRad = angleDeg * Math.PI / 180
  const nx = (CX + NEEDLE * Math.cos(angleRad)).toFixed(2)
  const ny = (CY - NEEDLE * Math.sin(angleRad)).toFixed(2)

  const needleColor = value == null ? 'rgba(255,255,255,0.2)'
    : value < 33 ? '#6BE3A4'
    : value < 66 ? '#F2C063'
    : '#EF4444'

  const zone = value == null ? null
    : value < 25 ? 'Calm'
    : value < 45 ? 'Low'
    : value < 65 ? 'Moderate'
    : value < 80 ? 'Elevated'
    : 'High'

  const micro = value == null
    ? 'Connect Google Health to track stress.'
    : value < 33 ? "Nervous system is calm. Good day to push hard."
    : value < 66 ? "Some load on the system. Train smart today."
    : "High stress detected. Prioritize recovery."

  return (
    <div className="health-card health-stress-card">
      <div className="health-card-header">
        <span className="health-card-label">Stress (est.)</span>
        {zone && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: needleColor }}>
            {zone}
          </span>
        )}
      </div>
      <div className="stress-gauge-wrap">
        <svg viewBox={`0 0 200 ${CY + 6}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <linearGradient id="sgGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#6BE3A4" stopOpacity={0.92} />
              <stop offset="50%"  stopColor="#F2C063" stopOpacity={0.92} />
              <stop offset="100%" stopColor="#EF4444" stopOpacity={0.92} />
            </linearGradient>
            <filter id="sgNGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {/* Background track */}
          <path
            d={`M ${CX - R},${CY} A ${R},${R} 0 0,1 ${CX + R},${CY}`}
            fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={14} strokeLinecap="round"
          />
          {/* Gradient color arc */}
          <path
            d={`M ${CX - R},${CY} A ${R},${R} 0 0,1 ${CX + R},${CY}`}
            fill="none" stroke="url(#sgGrad)" strokeWidth={8} strokeLinecap="round" opacity={0.9}
          />
          {/* Needle */}
          {value != null && (
            <line
              x1={CX} y1={CY} x2={nx} y2={ny}
              stroke={needleColor} strokeWidth={2.5} strokeLinecap="round"
              filter="url(#sgNGlow)"
            />
          )}
          {/* Base pivot */}
          <circle cx={CX} cy={CY} r={5.5} fill={needleColor} opacity={value != null ? 0.92 : 0.3} />
        </svg>
        <div className="stress-gauge-value" style={{ color: needleColor }}>
          {value != null ? animated : '—'}
        </div>
      </div>
      <p className="health-micro-copy">{micro}</p>
    </div>
  )
}

// ── Sleep breakdown ──

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
            {stages.deep  > 0 && <div className="sleep-stage deep"  style={{ flex: stages.deep  }} title={`Deep: ${stages.deep}m`}  />}
            {stages.rem   > 0 && <div className="sleep-stage rem"   style={{ flex: stages.rem   }} title={`REM: ${stages.rem}m`}    />}
            {stages.light > 0 && <div className="sleep-stage light" style={{ flex: stages.light }} title={`Light: ${stages.light}m`} />}
            {stages.wake  > 0 && <div className="sleep-stage wake"  style={{ flex: stages.wake  }} title={`Awake: ${stages.wake}m`}  />}
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

// ── Mini stat card ──

function MiniStat({ label, value, unit, color, micro }) {
  const animated = useCountUp(typeof value === 'number' ? value : null)
  return (
    <div className="health-mini-stat">
      <div className="health-stat-label">{label}</div>
      <div className="health-mini-value" style={{ color: value != null ? (color ?? 'var(--text-primary)') : 'rgba(255,255,255,0.18)' }}>
        {value != null ? animated : '—'}
        {value != null && unit && <span className="health-stat-unit">{unit}</span>}
      </div>
      {micro && <div className="health-stat-micro">{micro}</div>}
    </div>
  )
}

// ── AI analysis prompt builder ──

async function buildAnalysisPrompt(history) {
  const last7 = history.slice(-7)
  const healthRows = last7.map(d => {
    const s = d.sleep_stages
    const asleepH = s ? +((s.deep + s.light + s.rem) / 60).toFixed(1) : null
    return {
      date:       d.date,
      sleep:      d.sleep_score != null ? `${d.sleep_score}pts/${asleepH ?? '?'}h` : null,
      hrv:        d.hrv != null ? `${Math.round(d.hrv)}ms` : null,
      resting_hr: d.resting_hr != null ? `${d.resting_hr}bpm` : null,
    }
  })

  const logs = storeGet('gym_workout_logs') ?? []
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const gymRows = logs
    .filter(l => l.date >= cutoffStr)
    .map(l => ({
      date: l.date,
      exercises: (l.exercises ?? []).map(e => {
        const top = e.sets?.reduce((b, s) => (!b || (s.e1rm ?? 0) > (b.e1rm ?? 0)) ? s : b, null)
        return `${e.name}${top ? ` (${top.weight}×${top.reps})` : ''}`
      }),
    }))

  const avgSleep = avg(last7.filter(d => d.sleep_score).map(d => d.sleep_score))
  const avgHRV   = avg(last7.filter(d => d.hrv).map(d => d.hrv))
  const avgHR    = avg(last7.filter(d => d.resting_hr).map(d => d.resting_hr))

  return `You are a concise personal health coach. Give 3–4 direct, specific insights. No fluff.

7-day averages: sleep ${avgSleep?.toFixed(0) ?? 'N/A'}pts, HRV ${avgHRV?.toFixed(0) ?? 'N/A'}ms, resting HR ${avgHR?.toFixed(0) ?? 'N/A'}bpm

HEALTH: ${JSON.stringify(healthRows)}

WORKOUTS: ${gymRows.length ? JSON.stringify(gymRows) : 'None this week.'}

Respond with 3–4 bullet points. Use **bold** for key terms. Cover: recovery quality, training load vs readiness, any trends, and one concrete action for the next 24–48h.`
}

// ── Icons ──

const HeartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
)

const TrendsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="22,7 13.5,15.5 8.5,10.5 2,17" />
    <polyline points="16,7 22,7 22,13" />
  </svg>
)

// ── Main Health component ──

export default function Health() {
  const { flipped, animState, isFlipping, flip } = useFlip(false)
  const view = flipped ? 'trends' : 'overview'
  const [history,    setHistory]    = useState([])
  const [syncStatus, setSyncStatus] = useState(null)
  const [lastSync,   setLastSync]   = useState(() => getGfitLastSync())
  const [syncing,    setSyncing]    = useState(false)
  const [connected,  setConnected]  = useState(() => isGfitConnected())
  const [syncError,  setSyncError]  = useState(() => localStorage.getItem('health_sync_error'))
  const [analysis,   setAnalysis]   = useState(null)
  const [aiLoading,  setAiLoading]  = useState(false)

  const today     = history.find(d => d.date === todayStr()) ?? null
  const readiness = computeReadiness(today, history)
  const stress    = computeStress(today, history)

  const loadHistory = useCallback(async () => {
    const data = await fetchHealthHistory(30)
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

  const handleAnalyze = useCallback(async () => {
    const key = getAnthropicKey()
    if (!key) { setAnalysis({ error: 'No API key — add your Anthropic key in Settings.' }); return }
    setAiLoading(true)
    setAnalysis(null)
    try {
      const prompt = await buildAnalysisPrompt(history)
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: ANALYSIS_MODEL,
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? 'API error')
      setAnalysis({ text: data.content?.[0]?.text ?? '' })
    } catch (err) {
      setAnalysis({ error: err.message })
    } finally {
      setAiLoading(false)
    }
  }, [history])

  const hrvBaseline = avg(history.slice(-30).filter(d => d.hrv != null).map(d => d.hrv))
  const hrBaseline  = avg(history.slice(-30).filter(d => d.resting_hr != null).map(d => d.resting_hr))
  const hrvDiff = today?.hrv != null && hrvBaseline != null ? Math.round(today.hrv - hrvBaseline) : null
  const hrDiff  = today?.resting_hr != null && hrBaseline != null ? Math.round(today.resting_hr - hrBaseline) : null

  // ── Dynamic card grids (dc-) — wired like DashboardCards ──
  const { editing: ctxEditing, layoutMode, setLayoutMode } = useUIEdit()
  const [devEditing, setDevEditing] = useState(false)
  useEffect(() => {
    const onToggle = () => setDevEditing(v => !v)
    window.addEventListener('dc-toggle-edit', onToggle)
    return () => window.removeEventListener('dc-toggle-edit', onToggle)
  }, [])
  const editing = ctxEditing || devEditing

  // Widgets read page state through this ref: fresh on every render, but the
  // registries (built once) keep stable component identities — no remounts
  // when data or AI state changes, so charts never replay animations.
  const cardCtxRef = useRef(null)
  cardCtxRef.current = {
    today, history, readiness, stress, hrvDiff, hrDiff,
    analysis, aiLoading, onAnalyze: handleAnalyze,
  }
  const overviewRegistry = useMemo(() => buildHealthOverviewRegistry(cardCtxRef), [])
  const trendsRegistry   = useMemo(() => buildHealthTrendsRegistry(cardCtxRef), [])
  const hasData = history.length > 0

  return (
    <div className="health-page">
      <BackgroundBlob page="health" />

      {/* ── Header ── */}
      <div className="health-page-header">
        <div>
          <h1 className="health-title">Health</h1>
          <div className="page-subtitle">
            {lastSync
              ? `Synced ${relativeTime(lastSync)}`
              : connected ? 'Syncing…' : 'Connect Google Health in Settings'}
          </div>
        </div>
        <div className="health-header-right">
          {connected && (
            <button
              className="health-sync-btn"
              onClick={handleSync}
              disabled={syncing || syncStatus === 'syncing'}
              aria-label="Sync now"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"
                style={{ display: 'block', transition: 'transform 0.6s', transform: syncing ? 'rotate(360deg)' : 'none' }}>
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

      {/* ── View toggle (tap to flip Overview ⇄ Trends) ── */}
      <div className="health-view-bar">
        <FlipTitle
          icon={view === 'overview' ? <HeartIcon /> : <TrendsIcon />}
          label={view === 'overview' ? 'Overview' : 'Trends'}
          isFlipping={isFlipping}
          onClick={() => flip()}
          title={view === 'overview' ? 'Switch to Trends' : 'Switch to Overview'}
        />
      </div>

      {/* ── Connect banner ── */}
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

      {/* ── Sync error banner ── */}
      {syncError && (
        <div className="health-error-banner">
          <span className="health-error-icon">⚠</span>
          <span className="health-error-msg">Sync failed: {syncError}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {syncError.includes('403') && (
              <button className="btn-ghost health-error-dismiss" onClick={() => window.dispatchEvent(new Event('open-settings'))}>Reconnect</button>
            )}
            <button className="btn-ghost health-error-dismiss" onClick={() => { localStorage.removeItem('health_sync_error'); setSyncError(null) }}>Dismiss</button>
          </div>
        </div>
      )}

      {/* ══ Switchable content (flips between Overview & Trends) ══ */}
      <div className={`health-views flip-content${animState ? ' ' + animState : ''}`}>
        {view === 'overview' ? (
          hasData ? (
            <CardGrid
              area="health_overview"
              registry={overviewRegistry}
              defaultOrder={HEALTH_OVERVIEW_ORDER}
              editing={editing}
              mode={layoutMode}
              onAdoptAuto={() => setLayoutMode('manual')}
            />
          ) : (
          <>
            {/* Stress gauge — top of the overview */}
            <div className="stagger-1">
              <StressGauge value={stress} />
            </div>

            {/* Readiness + Sleep rings */}
            <div className="health-rings-row stagger-2">
              <StatRing
                value={readiness}
                label="Readiness"
                sublabel={readiness == null ? null : readiness >= 80 ? 'Optimal' : readiness >= 60 ? 'Good' : 'Low'}
                color={readiness == null || readiness >= 70 ? '#6BE3A4' : readiness >= 50 ? '#F2C063' : '#EF4444'}
              />
              <StatRing
                value={today?.sleep_score}
                label="Sleep Score"
                sublabel={today?.sleep_score == null ? null : today.sleep_score >= 80 ? 'Excellent' : today.sleep_score >= 60 ? 'Fair' : 'Poor'}
                color="#7048E8"
              />
            </div>

            {/* HRV + Resting HR */}
            <div className="health-mini-stats-row stagger-3">
              <MiniStat
                label="HRV"
                value={today?.hrv != null ? Math.round(today.hrv) : null}
                unit="ms"
                color="#00C896"
                micro={hrvDiff == null ? null : `${hrvDiff > 0 ? '+' : ''}${hrvDiff} vs baseline`}
              />
              <MiniStat
                label="Resting HR"
                value={today?.resting_hr ?? null}
                unit="bpm"
                color="#E8A020"
                micro={hrDiff == null ? null : hrDiff === 0 ? 'At baseline' : `${hrDiff > 0 ? '+' : ''}${hrDiff} vs baseline`}
              />
            </div>

            {/* Sleep breakdown */}
            <div className="stagger-4">
              <SleepCard today={today} />
            </div>
          </>
          )
        ) : (
          hasData ? (
            <CardGrid
              area="health_trends"
              registry={trendsRegistry}
              defaultOrder={HEALTH_TRENDS_ORDER}
              editing={editing}
              mode={layoutMode}
              onAdoptAuto={() => setLayoutMode('manual')}
            />
          ) : (
          <>
            <div className="health-section-label stagger-1">Sleep</div>
            <div className="health-chart-row stagger-1">
              <SleepTrendChart history={history} />
              <SleepStagesChart history={history} />
            </div>

            <div className="health-section-label stagger-2">Recovery</div>
            <div className="health-chart-row stagger-2">
              <HRVTrendChart history={history} />
              <RestingHRChart history={history} />
            </div>

            <div className="health-section-label stagger-3">AI Coach</div>
            <div className="health-ai-card stagger-3">
              <div className="health-ai-top">
                <div>
                  <div className="health-card-label">Weekly Health Analysis</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
                    7 days of health + training data
                  </div>
                </div>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: '6px 14px', flexShrink: 0 }}
                  onClick={handleAnalyze}
                  disabled={aiLoading}
                >
                  {aiLoading ? 'Analyzing…' : analysis ? 'Refresh' : 'Analyze'}
                </button>
              </div>
              {analysis?.error && (
                <div className="health-ai-error">{analysis.error}</div>
              )}
              {analysis?.text && (
                <div className="health-ai-result">
                  {renderMarkdown(analysis.text)}
                </div>
              )}
              {!analysis && !aiLoading && (
                <div className="health-ai-placeholder">
                  Tap Analyze for personalized insights based on your health and workout data.
                </div>
              )}
            </div>
          </>
          )
        )}
      </div>
    </div>
  )
}
