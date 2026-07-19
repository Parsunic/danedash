import { useState, useEffect, useCallback } from 'react'
import {
  getEntries, logEntry, deltas, convertWeight, seriesIn, currentUnit,
} from '../../lib/bodyMetrics.js'

// Health Overview weigh-in card (registry id 'bodyweight'). Self-contained: reads
// its own body_metrics_v1 key, listens 'sync-applied' to re-read after a remote
// pull, and writes only on the Log gesture (logEntry → storeSet). Card chrome is
// the CardShell .dc-card; this renders content within .dc-health-widget.
//   M: latest weight hero + Δ7d/Δ30d pair + inline log input.
//   L: + 30-weigh-in sparkline + optional waist field + voice line.

function fmtWeight(v) {
  if (v == null) return '—'
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

function fmtDelta(v) {
  if (v == null) return '—'
  if (v === 0) return '±0'
  const abs = Math.abs(Math.round(v * 10) / 10)
  const n = Number.isInteger(abs) ? abs : abs.toFixed(1)
  return `${v < 0 ? '▼' : '▲'}${n}`
}

function prettyDate(ds) {
  const [y, m, d] = ds.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Hand-rolled sparkline (SleepWidget idiom) — no recharts ResponsiveContainer, so
// no fixed-cell ResizeObserver blowout. Stretches to card width.
function Sparkline({ values }) {
  const W = 100, H = 30, pad = 3
  const pts = values.filter(v => v != null)
  if (pts.length < 2) return null
  const min = Math.min(...pts), max = Math.max(...pts)
  const span = max - min || 1
  const step = (W - pad * 2) / (pts.length - 1)
  const coords = pts.map((v, i) => {
    const x = pad + i * step
    const y = pad + (H - pad * 2) * (1 - (v - min) / span)
    return [x, y]
  })
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ')
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${H} L${coords[0][0].toFixed(1)},${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 34, display: 'block' }}>
      <defs>
        <linearGradient id="dc-body-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(232,160,32,0.28)" />
          <stop offset="100%" stopColor="rgba(232,160,32,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#dc-body-spark)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Delta({ label, v }) {
  return (
    <span className="dc-health-weight-delta">
      <span className="dc-health-weight-delta-k">{label}</span>
      <span className="dc-health-weight-delta-v">{fmtDelta(v)}</span>
    </span>
  )
}

export default function BodyMetricsCard({ size }) {
  const [entries, setEntries] = useState(getEntries)
  const [weightInput, setWeightInput] = useState('')
  const [waistInput, setWaistInput] = useState('')

  const refresh = useCallback(() => setEntries(getEntries()), [])
  useEffect(() => {
    window.addEventListener('sync-applied', refresh)
    return () => window.removeEventListener('sync-applied', refresh)
  }, [refresh])

  const unit = currentUnit()
  const latest = entries.length ? entries[entries.length - 1] : null
  const latestW = latest ? convertWeight(latest.weight, latest.unit, unit) : null
  const { d7, d30 } = deltas(entries, unit)
  const isL = size === 'L'

  const handleLog = useCallback(() => {
    const w = parseFloat(weightInput)
    if (!Number.isFinite(w) || w <= 0) return
    const next = logEntry({ weight: w, waist: isL ? waistInput : undefined })
    setEntries(next)
    setWeightInput('')
    setWaistInput('')
  }, [weightInput, waistInput, isL])

  const onKey = (e) => { if (e.key === 'Enter') handleLog() }
  const heroSize = isL ? 40 : 34
  const sparkValues = isL ? seriesIn(entries, unit).slice(-30).map(p => p.weight) : []
  const voice = d7 == null ? 'One data point down. Keep weighing in.' : 'Every weigh-in sharpens the picture.'

  return (
    <div className="dc-health-widget">
      <div className="health-card-header" style={{ marginBottom: 4 }}>
        <span className="health-card-label">Body Weight</span>
        {latest && <span className="health-chart-meta">{prettyDate(latest.date)}</span>}
      </div>

      {latest ? (
        <>
          <div className="dc-health-weight-hero">
            <span className="dc-health-weight-num" style={{ fontSize: heroSize }}>{fmtWeight(latestW)}</span>
            <span className="dc-health-weight-unit">{unit}</span>
          </div>
          <div className="dc-health-weight-deltaline">
            <Delta label="7d" v={d7} />
            <Delta label="30d" v={d30} />
          </div>
          {isL && sparkValues.length >= 2 && (
            <div className="dc-health-weight-spark">
              <Sparkline values={sparkValues} />
              <div className="health-stat-label" style={{ marginTop: 4, marginBottom: 0 }}>
                last {sparkValues.length} weigh-ins
              </div>
            </div>
          )}
          {isL && <p className="health-micro-copy" style={{ marginTop: 8 }}>{voice}</p>}
        </>
      ) : (
        <div className="health-empty" style={{ marginTop: 2 }}>No weigh-ins yet — start today.</div>
      )}

      <div className="dc-health-weight-form">
        <div className="dc-health-weight-row">
          <input
            className="dc-health-weight-input"
            type="number" inputMode="decimal" step="0.1" min="0"
            placeholder={`Weight (${unit})`}
            value={weightInput}
            onChange={e => setWeightInput(e.target.value)}
            onKeyDown={onKey}
            aria-label="Weight"
          />
          <button className="btn-secondary dc-health-weight-btn" onClick={handleLog}>Log</button>
        </div>
        {isL && (
          <input
            className="dc-health-weight-input"
            type="number" inputMode="decimal" step="0.1" min="0"
            placeholder="Waist (optional)"
            value={waistInput}
            onChange={e => setWaistInput(e.target.value)}
            onKeyDown={onKey}
            aria-label="Waist (optional)"
          />
        )}
      </div>
    </div>
  )
}
