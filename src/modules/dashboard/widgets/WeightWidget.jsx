import { useState, useEffect, useCallback } from 'react'
import { getEntries, deltas, convertWeight, seriesIn, currentUnit } from '../../../lib/bodyMetrics.js'

// Dashboard weight widget (registry id 'weight'). Read-only mirror of the body
// metrics log — logging lives on the Health Overview card. Self-contained: reads
// body_metrics_v1 and re-reads on 'sync-applied'.
//   S: latest weight + Δ7d arrow.  M: + 30-weigh-in sparkline.

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const HERO = { fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 40, lineHeight: 1, color: 'var(--text-primary)' }

function fmtWeight(v) {
  if (v == null) return '—'
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

// Hand-rolled sparkline (SleepWidget idiom).
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
        <linearGradient id="dc-weightw-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(232,160,32,0.28)" />
          <stop offset="100%" stopColor="rgba(232,160,32,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#dc-weightw-spark)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function WeightWidget({ size }) {
  const [entries, setEntries] = useState(getEntries)
  const refresh = useCallback(() => setEntries(getEntries()), [])
  useEffect(() => {
    window.addEventListener('sync-applied', refresh)
    return () => window.removeEventListener('sync-applied', refresh)
  }, [refresh])

  const unit = currentUnit()
  const latest = entries.length ? entries[entries.length - 1] : null
  const latestW = latest ? convertWeight(latest.weight, latest.unit, unit) : null
  const { d7 } = deltas(entries, unit)

  // ── Empty ──
  if (!latest) {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-label">Weight</div>
        <div style={{ ...HERO, color: 'var(--text-tertiary)', marginTop: 6 }}>—</div>
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>Log in Health</div>
      </div>
    )
  }

  const deltaEl = d7 != null && d7 !== 0 ? (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
      {d7 < 0 ? '▼' : '▲'} {Math.abs(Math.round(d7 * 10) / 10)}
    </span>
  ) : null

  const hero = (
    <>
      <div className="dash-widget-label">Weight</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span style={HERO}>{fmtWeight(latestW)}</span>
        {deltaEl}
      </div>
      <div className="dash-widget-label" style={{ marginTop: 3 }}>{unit}{d7 != null ? ' · 7d change' : ''}</div>
    </>
  )

  // ── S: latest + Δ7d ──
  if (size === 'S') {
    return (
      <div style={ROOT_STYLE}>
        {hero}
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>
          {d7 == null ? 'Keep weighing in.' : d7 < 0 ? 'Trending down.' : d7 > 0 ? 'Trending up.' : 'Holding steady.'}
        </div>
      </div>
    )
  }

  // ── M: + sparkline ──
  const spark = seriesIn(entries, unit).slice(-30).map(p => p.weight)
  return (
    <div style={ROOT_STYLE}>
      {hero}
      <div style={{ marginTop: 'auto', paddingTop: 10 }}>
        <Sparkline values={spark} />
        <div className="dash-widget-label" style={{ marginTop: 2 }}>last {spark.length} weigh-ins</div>
      </div>
    </div>
  )
}
