import { useState, useEffect, useRef, useMemo } from 'react'
import {
  SleepTrendChart, SleepStagesChart, HRVTrendChart, RestingHRChart, WeeklyActivityChart,
  ReadinessTrendChart, SleepPerformanceChart, WeightTrendChart,
} from './HealthCharts.jsx'
import { renderMarkdown } from '../../lib/renderMarkdown.jsx'
import { storeGet } from '../../lib/storage.js'
import { trainingVerdict, verdictInputs, sleepPerformancePairs } from './readinessUtils.js'
import BodyMetricsCard from './BodyMetricsCard.jsx'
import { getEntries as getBodyEntries, currentUnit } from '../../lib/bodyMetrics.js'

// Health module card registries (areas 'health_overview' + 'health_trends').
//
// Widgets close over a ctx REF owned by Health.jsx (page state: today, history,
// readiness, stress, diffs, AI state) — no new fetches here. Builders run ONCE
// per Health mount (useMemo []) so component identities stay stable: data/AI
// state changes re-RENDER widgets (they read ctxRef.current at render time) but
// never REMOUNT them — charts don't replay animations when e.g. aiLoading flips.
// Chrome comes from CardShell's .dc-card; these widgets render content only,
// reusing the existing .health-* content classes (headers, bars, legends).

// ── Icons (tray chips + registry metadata) ──

const ICON_PROPS = {
  width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
}

const ICONS = {
  readiness: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  ),
  sleep: (
    <svg {...ICON_PROPS}>
      <path d="M21 12.8A8 8 0 1 1 11.2 3a6.2 6.2 0 0 0 9.8 9.8z" />
    </svg>
  ),
  stress: (
    <svg {...ICON_PROPS}>
      <path d="M4 17a8 8 0 1 1 16 0" opacity="0.4" />
      <path d="M12 17l4-6" />
    </svg>
  ),
  stages: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="10" width="18" height="5" rx="1.5" opacity="0.4" />
      <path d="M3 12.5h6" />
    </svg>
  ),
  hrv: (
    <svg {...ICON_PROPS}>
      <path d="M2 12h4l3-8 4 16 3-8h6" />
    </svg>
  ),
  heart: (
    <svg {...ICON_PROPS}>
      <path d="M19.5 12.5L12 20l-7.5-7.5a5 5 0 1 1 7.5-6.5 5 5 0 1 1 7.5 6.5z" />
    </svg>
  ),
  trend: (
    <svg {...ICON_PROPS}>
      <polyline points="22,7 13.5,15.5 8.5,10.5 2,17" />
      <polyline points="16,7 22,7 22,13" />
    </svg>
  ),
  bars: (
    <svg {...ICON_PROPS}>
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
  ),
  steps: (
    <svg {...ICON_PROPS}>
      <path d="M4 20v-5M9 20V9M14 20v-8M19 20V5" />
    </svg>
  ),
  ai: (
    <svg {...ICON_PROPS}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    </svg>
  ),
  verdict: (
    <svg {...ICON_PROPS}>
      <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
    </svg>
  ),
  corr: (
    <svg {...ICON_PROPS}>
      <path d="M3 3v18h18" opacity="0.4" />
      <circle cx="9" cy="14" r="1.4" />
      <circle cx="13" cy="9" r="1.4" />
      <circle cx="17" cy="12" r="1.4" />
      <circle cx="19" cy="6" r="1.4" />
    </svg>
  ),
  weight: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="3" width="18" height="18" rx="4" opacity="0.4" />
      <path d="M12 8l2.5 3.5" />
      <circle cx="12" cy="12" r="0.6" />
    </svg>
  ),
  weighttrend: (
    <svg {...ICON_PROPS}>
      <path d="M3 17l5-5 4 3 6-7" />
      <path d="M14 8h4v4" opacity="0.5" />
    </svg>
  ),
}

// ── Gym logs (verdict + correlation cards derive volume at render time) ──

function useGymLogs() {
  const [logs, setLogs] = useState(() => storeGet('gym_workout_logs') ?? [])
  useEffect(() => {
    // Compare before setState so sync-applied storms don't re-render for
    // identical data (read-only handler per sync discipline).
    const reload = () => setLogs(prev => {
      const next = storeGet('gym_workout_logs') ?? []
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
    })
    window.addEventListener('gym-changed', reload)
    window.addEventListener('sync-applied', reload)
    return () => {
      window.removeEventListener('gym-changed', reload)
      window.removeEventListener('sync-applied', reload)
    }
  }, [])
  return logs
}

// ── Count-up (copied from Health.jsx — page original stays for the no-data face) ──

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

// ── Ring primitive (parameterized size so S cells fit) ──

function CellRing({ value, color, px, stroke }) {
  const animated = useCountUp(value)
  const r = (px - stroke * 2) / 2
  const C = 2 * Math.PI * r
  const pct = value != null ? Math.min(Math.max(value / 100, 0), 1) : 0
  return (
    <div style={{ position: 'relative', width: px, height: px, flexShrink: 0 }}>
      <svg width={px} height={px} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        {value != null && (
          <circle
            cx={px / 2} cy={px / 2} r={r}
            fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${C * pct} ${C}`}
            style={{ transition: 'stroke-dasharray 0.85s ease-out' }}
          />
        )}
      </svg>
      <div className="health-ring-inner">
        <div
          className="health-ring-number"
          style={{
            fontSize: Math.round(px * 0.27),
            color: value != null ? 'var(--text-primary)' : 'rgba(255,255,255,0.18)',
          }}
        >
          {value != null ? animated : '—'}
        </div>
      </div>
    </div>
  )
}

// ── Widget factories (all close over ctxRef) ──

function makeRingWidget(ctxRef, pick) {
  return function RingWidget({ size, bp }) {
    const c = pick(ctxRef.current)
    if (size === 'S') {
      const px = bp === 'mobile' ? 64 : 86
      return (
        <div className="dc-health-ring-s">
          <CellRing value={c.value} color={c.color} px={px} stroke={bp === 'mobile' ? 6 : 7} />
          <div className="health-ring-label">{c.label}</div>
          {c.sublabel && <div className="health-ring-sublabel" style={{ color: c.color }}>{c.sublabel}</div>}
        </div>
      )
    }
    return (
      <div className="dc-health-ring-m">
        <CellRing value={c.value} color={c.color} px={96} stroke={8} />
        <div className="dc-health-ring-m-info">
          <div className="health-ring-label">{c.label}</div>
          {c.sublabel && (
            <div className="health-ring-sublabel" style={{ color: c.color, fontSize: 11 }}>{c.sublabel}</div>
          )}
          {c.micro && <p className="health-micro-copy" style={{ marginTop: 4 }}>{c.micro}</p>}
        </div>
      </div>
    )
  }
}

function makeStatWidget(ctxRef, pick) {
  return function StatWidget() {
    const c = pick(ctxRef.current)
    const animated = useCountUp(typeof c.value === 'number' ? c.value : null)
    return (
      <div className="dc-health-stat">
        <div className="health-stat-label">{c.label}</div>
        <div
          className="health-mini-value"
          style={{ color: c.value != null ? c.color : 'rgba(255,255,255,0.18)' }}
        >
          {c.value != null ? animated : '—'}
          {c.value != null && c.unit && <span className="health-stat-unit">{c.unit}</span>}
        </div>
        {c.micro && <div className="health-stat-micro">{c.micro}</div>}
      </div>
    )
  }
}

function makeStressWidget(ctxRef) {
  return function StressWidget({ size }) {
    const value = ctxRef.current.stress
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
      : value < 33 ? 'Nervous system is calm. Good day to push hard.'
      : value < 66 ? 'Some load on the system. Train smart today.'
      : 'High stress detected. Prioritize recovery.'

    const gauge = (
      <div className="dc-health-gauge-box">
        <svg viewBox={`0 0 200 ${CY + 6}`} preserveAspectRatio="xMidYMax meet">
          <defs>
            <linearGradient id="dcSgGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#6BE3A4" stopOpacity={0.92} />
              <stop offset="50%"  stopColor="#F2C063" stopOpacity={0.92} />
              <stop offset="100%" stopColor="#EF4444" stopOpacity={0.92} />
            </linearGradient>
            <filter id="dcSgGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path
            d={`M ${CX - R},${CY} A ${R},${R} 0 0,1 ${CX + R},${CY}`}
            fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={14} strokeLinecap="round"
          />
          <path
            d={`M ${CX - R},${CY} A ${R},${R} 0 0,1 ${CX + R},${CY}`}
            fill="none" stroke="url(#dcSgGrad)" strokeWidth={8} strokeLinecap="round" opacity={0.9}
          />
          {value != null && (
            <line
              x1={CX} y1={CY} x2={nx} y2={ny}
              stroke={needleColor} strokeWidth={2.5} strokeLinecap="round"
              filter="url(#dcSgGlow)"
            />
          )}
          <circle cx={CX} cy={CY} r={5.5} fill={needleColor} opacity={value != null ? 0.92 : 0.3} />
        </svg>
        {size === 'S' && (
          <div className="dc-health-gauge-value" style={{ color: needleColor, fontSize: 20 }}>
            {value != null ? animated : '—'}
          </div>
        )}
      </div>
    )

    const header = (
      <div className="health-card-header" style={{ marginBottom: 6 }}>
        <span className="health-card-label">Stress (est.)</span>
        {zone && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: needleColor }}>
            {zone}
          </span>
        )}
      </div>
    )

    if (size === 'S') {
      return (
        <div className="dc-health-widget">
          {header}
          {gauge}
        </div>
      )
    }
    return (
      <div className="dc-health-widget">
        {header}
        {/* stretch (not center) so the gauge box gets a definite height — an
            auto-height box makes the svg fall back to aspect sizing and overflow */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 18, flex: 1, minHeight: 0 }}>
          {gauge}
          <div style={{ width: 132, flexShrink: 0, alignSelf: 'center' }}>
            <div className="dc-health-gauge-value-inline" style={{ color: needleColor }}>
              {value != null ? animated : '—'}
            </div>
            <p className="health-micro-copy" style={{ marginTop: 6 }}>{micro}</p>
          </div>
        </div>
      </div>
    )
  }
}

function makeStagesWidget(ctxRef) {
  return function StagesWidget({ size }) {
    const { today } = ctxRef.current
    const stages    = today?.sleep_stages
    const total     = stages ? (stages.deep + stages.light + stages.rem + (stages.wake ?? 0)) : 0
    const asleepMin = stages ? (stages.deep + stages.light + stages.rem) : 0
    const h = Math.floor(asleepMin / 60)
    const m = asleepMin % 60
    return (
      <div className="dc-health-widget">
        <div className="health-card-header">
          <span className="health-card-label">Last Night</span>
          {stages && total > 0 && <span className="health-card-value">{h}h {m}m</span>}
        </div>
        {stages && total > 0 ? (
          <>
            <div className="sleep-stages-bar" style={size === 'L' ? { height: 34 } : undefined}>
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
            {size === 'L' && (
              <p className="health-micro-copy" style={{ marginTop: 'auto' }}>
                {stages.deep >= 90 ? "Deep sleep locked in. Body's doing the work." : "Chasing that deep sleep. You're getting there."}
              </p>
            )}
          </>
        ) : (
          <div className="health-empty">No sleep data for today yet</div>
        )}
      </div>
    )
  }
}

// key={size} remounts the chart on size cycling — recharts are stateless and
// remeasure cleanly; the engine also fires window.resize after the reflow.
function makeChartWidget(ctxRef, Chart, opts = {}) {
  return function ChartWidget({ size }) {
    const { history } = ctxRef.current
    const extra = opts.stages ? { hideKey: size === 'M' } : {}
    return <Chart key={size} history={history} fill {...extra} />
  }
}

function makeAIWidget(ctxRef) {
  return function AIWidget() {
    const { analysis, aiLoading, onAnalyze } = ctxRef.current
    return (
      <div className="dc-health-widget">
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
            onClick={onAnalyze}
            disabled={aiLoading}
          >
            {aiLoading ? 'Analyzing…' : analysis ? 'Refresh' : 'Analyze'}
          </button>
        </div>
        <div className="dc-health-ai-scroll">
          {analysis?.error && <div className="health-ai-error">{analysis.error}</div>}
          {analysis?.text && <div className="health-ai-result">{renderMarkdown(analysis.text)}</div>}
          {!analysis && !aiLoading && (
            <div className="health-ai-placeholder">
              Tap Analyze for personalized insights based on your health and workout data.
            </div>
          )}
        </div>
      </div>
    )
  }
}

// ── Training verdict (F2) — readiness + recent gym volume → train/steady/easy ──

const VERDICT_COLORS = {
  'Train hard': '#6BE3A4',
  'Steady':     '#E8A020',
  'Go easy':    '#7048E8',
}

function makeVerdictWidget(ctxRef) {
  return function VerdictWidget({ size }) {
    const logs = useGymLogs()
    const readiness = ctxRef.current.readiness
    const inputs = useMemo(() => verdictInputs(logs), [logs])
    const { verdict, reason } = trainingVerdict({ todayReadiness: readiness, ...inputs })
    const color = VERDICT_COLORS[verdict] ?? 'rgba(255,255,255,0.25)'
    const sub = readiness != null ? `${readiness}% ready` : 'no data yet'
    const volLine = `${(inputs.yesterdayVolume ?? 0).toLocaleString()} lbs yesterday`

    const header = (
      <div className="health-card-header" style={{ marginBottom: 4 }}>
        <span className="health-card-label">Training</span>
      </div>
    )

    if (size === 'S') {
      return (
        <div className="dc-health-widget">
          {header}
          <div className="dc-health-verdict-center">
            <div className="dc-health-verdict-word" style={{ color }}>{verdict ?? '—'}</div>
            <div className="dc-health-verdict-sub">{sub}</div>
          </div>
        </div>
      )
    }
    return (
      <div className="dc-health-widget">
        {header}
        <div className="dc-health-verdict-row">
          <div>
            <div className="dc-health-verdict-word" style={{ color }}>{verdict ?? '—'}</div>
            <div className="dc-health-verdict-sub">{sub}</div>
          </div>
          <div className="dc-health-verdict-info">
            <p className="health-micro-copy" style={{ margin: 0 }}>{reason}</p>
            <div className="dc-health-verdict-vol">{volLine}</div>
          </div>
        </div>
      </div>
    )
  }
}

// ── Sleep × Training correlation (F2) — n<5 shows an empty state ──

function makeCorrelationWidget(ctxRef) {
  return function CorrelationWidget({ size }) {
    const logs = useGymLogs()
    const { history } = ctxRef.current
    const { pairs, r, n } = useMemo(() => sleepPerformancePairs(history, logs), [history, logs])

    if (n < 5) {
      return (
        <div className="dc-health-widget">
          <div className="health-card-header">
            <span className="health-card-label">Sleep × Training</span>
            <span className="health-chart-meta">needs 5+ paired days</span>
          </div>
          <div className="health-empty" style={{ margin: 'auto 0' }}>
            Not enough paired data yet — {n} day{n === 1 ? '' : 's'} with both sleep
            and a logged workout. Keep training.
          </div>
        </div>
      )
    }
    return <SleepPerformanceChart key={size} pairs={pairs} r={r} fill />
  }
}

// ── Overview registry (area 'health_overview') ──

export const HEALTH_OVERVIEW_ORDER = ['readiness', 'sleepring', 'stress', 'verdict', 'stages', 'hrv', 'rhr']

export function buildHealthOverviewRegistry(ctxRef) {
  return {
    readiness: {
      title: 'Readiness',
      icon: ICONS.readiness,
      component: makeRingWidget(ctxRef, ctx => {
        const r = ctx.readiness
        return {
          value: r,
          label: 'Readiness',
          sublabel: r == null ? null : r >= 80 ? 'Optimal' : r >= 60 ? 'Good' : 'Low',
          color: r == null || r >= 70 ? '#6BE3A4' : r >= 50 ? '#F2C063' : '#EF4444',
          micro: r == null ? null : r >= 80 ? 'Green light. Push hard today.' : r >= 60 ? 'Solid base. Train smart.' : 'Recovery first. Ease off.',
        }
      }),
      sizes: ['S', 'M'],
      defaultSize: 'S',
      autoPriority: 1,
      autoSize: { 2: 'S', 3: 'S', 4: 'S' },
    },
    sleepring: {
      title: 'Sleep Score',
      icon: ICONS.sleep,
      component: makeRingWidget(ctxRef, ctx => {
        const s = ctx.today?.sleep_score ?? null
        return {
          value: s,
          label: 'Sleep Score',
          sublabel: s == null ? null : s >= 80 ? 'Excellent' : s >= 60 ? 'Fair' : 'Poor',
          color: '#7048E8',
          micro: s == null ? null : s >= 80 ? 'Rested and ready.' : s >= 60 ? 'Decent night. Keep at it.' : 'Rough night. Sleep comes first tonight.',
        }
      }),
      sizes: ['S', 'M'],
      defaultSize: 'S',
      autoPriority: 2,
      autoSize: { 2: 'S', 3: 'S', 4: 'S' },
    },
    stress: {
      title: 'Stress',
      icon: ICONS.stress,
      component: makeStressWidget(ctxRef),
      sizes: ['S', 'M'],
      defaultSize: 'M',
      autoPriority: 3,
      autoSize: { 2: 'M', 3: 'M', 4: 'M' },
    },
    verdict: {
      title: 'Training Verdict',
      icon: ICONS.verdict,
      component: makeVerdictWidget(ctxRef),
      sizes: ['S', 'M'],
      defaultSize: 'S',
      autoPriority: 4,
      autoSize: { 2: 'S', 3: 'S', 4: 'S' },
    },
    stages: {
      title: 'Last Night',
      icon: ICONS.stages,
      component: makeStagesWidget(ctxRef),
      sizes: ['M', 'L'],
      defaultSize: 'M',
      autoPriority: 5,
      autoSize: { 2: 'M', 3: 'M', 4: 'M' },
    },
    hrv: {
      title: 'HRV',
      icon: ICONS.hrv,
      component: makeStatWidget(ctxRef, ctx => ({
        label: 'HRV',
        value: ctx.today?.hrv != null ? Math.round(ctx.today.hrv) : null,
        unit: 'ms',
        color: '#00C896',
        micro: ctx.hrvDiff == null ? null : `${ctx.hrvDiff > 0 ? '+' : ''}${ctx.hrvDiff} vs baseline`,
      })),
      sizes: ['S'],
      defaultSize: 'S',
      autoPriority: 6,
      autoSize: { 2: 'S', 3: 'S', 4: 'S' },
    },
    rhr: {
      title: 'Resting HR',
      icon: ICONS.heart,
      component: makeStatWidget(ctxRef, ctx => ({
        label: 'Resting HR',
        value: ctx.today?.resting_hr ?? null,
        unit: 'bpm',
        color: '#E8A020',
        micro: ctx.hrDiff == null ? null : ctx.hrDiff === 0 ? 'At baseline' : `${ctx.hrDiff > 0 ? '+' : ''}${ctx.hrDiff} vs baseline`,
      })),
      sizes: ['S'],
      defaultSize: 'S',
      autoPriority: 7,
      autoSize: { 2: 'S', 3: 'S', 4: 'S' },
    },
  }
}

// ── Trends registry (area 'health_trends') ──

export const HEALTH_TRENDS_ORDER = ['sleeptrend', 'sleepstages', 'hrvtrend', 'restinghr', 'weeklysteps', 'ai', 'readinesstrend', 'correlation']

export function buildHealthTrendsRegistry(ctxRef) {
  return {
    sleeptrend: {
      title: 'Sleep Trend',
      icon: ICONS.sleep,
      component: makeChartWidget(ctxRef, SleepTrendChart),
      sizes: ['M', 'L'],
      defaultSize: 'M',
      autoPriority: 1,
      autoSize: { 2: 'M', 3: 'M', 4: 'M' },
    },
    sleepstages: {
      title: 'Sleep Stages',
      icon: ICONS.bars,
      component: makeChartWidget(ctxRef, SleepStagesChart, { stages: true }),
      sizes: ['M', 'L'],
      defaultSize: 'M',
      autoPriority: 2,
      autoSize: { 2: 'M', 3: 'M', 4: 'M' },
    },
    hrvtrend: {
      title: 'HRV Trend',
      icon: ICONS.trend,
      component: makeChartWidget(ctxRef, HRVTrendChart),
      sizes: ['M', 'L'],
      defaultSize: 'M',
      autoPriority: 3,
      autoSize: { 2: 'M', 3: 'M', 4: 'M' },
    },
    restinghr: {
      title: 'Resting HR',
      icon: ICONS.heart,
      component: makeChartWidget(ctxRef, RestingHRChart),
      sizes: ['M', 'L'],
      defaultSize: 'M',
      autoPriority: 4,
      autoSize: { 2: 'M', 3: 'M', 4: 'M' },
    },
    weeklysteps: {
      title: 'Weekly Steps',
      icon: ICONS.steps,
      component: makeChartWidget(ctxRef, WeeklyActivityChart),
      sizes: ['M', 'L'],
      defaultSize: 'M',
      autoPriority: 5,
      autoSize: { 2: 'M', 3: 'M', 4: 'M' },
    },
    ai: {
      title: 'AI Coach',
      icon: ICONS.ai,
      component: makeAIWidget(ctxRef),
      sizes: ['L', 'XL'],
      defaultSize: 'L',
      autoPriority: 6,
      autoSize: { 2: 'L', 3: 'L', 4: 'L' },
    },
    readinesstrend: {
      title: 'Readiness Trend',
      icon: ICONS.readiness,
      component: makeChartWidget(ctxRef, ReadinessTrendChart),
      sizes: ['M', 'L'],
      defaultSize: 'M',
      autoPriority: 7,
      autoSize: { 2: 'M', 3: 'M', 4: 'M' },
    },
    correlation: {
      title: 'Sleep × Training',
      icon: ICONS.corr,
      component: makeCorrelationWidget(ctxRef),
      sizes: ['L', 'XL'],
      defaultSize: 'L',
      autoPriority: 8,
      autoSize: { 2: 'L', 3: 'L', 4: 'L' },
    },
  }
}
