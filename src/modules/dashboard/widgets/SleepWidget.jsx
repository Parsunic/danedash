import { useState, useEffect } from 'react'
import { getHealthRows, peekHealthRows, invalidateHealthCache } from './healthData.js'

// Sleep widget — last-night sleep score + 7-day context from health_metrics.
//
// Health rows come from the shared dashboard TTL cache (healthData.js) so the
// dashboard makes at most ONE health fetch across widgets (Sleep + Readiness).
// The cache holds 30 days for readiness baselines; we window down to the last
// 7 calendar days so every number here stays exactly what the old
// fetchHealthHistory(7) produced. A completed Google Health sync
// ('gfit-sync-status' → 'synced') invalidates the cache so fresh data appears
// without a reload. No mutation, read-only.

function weekWindowStart() {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const HERO = { fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 40, lineHeight: 1, color: 'var(--text-primary)' }

function fmtNum(n) {
  return n == null ? '—' : Number(n).toLocaleString('en-US')
}

// Hand-rolled sparkline (no recharts ResponsiveContainer — avoids the fixed-cell
// ResizeObserver blowout). Stretches to the card width via preserveAspectRatio.
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
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 38, display: 'block' }}>
      <defs>
        <linearGradient id="dc-sleep-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(232,160,32,0.28)" />
          <stop offset="100%" stopColor="rgba(232,160,32,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#dc-sleep-spark)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function MiniStat({ label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color: 'var(--text-primary)' }}>{value}</div>
      <div className="dash-widget-label" style={{ marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function SleepWidget({ size, bp }) {
  const [rows, setRows] = useState(() => healthCache.rows || null)
  const [loaded, setLoaded] = useState(() => !!healthCache.rows)

  useEffect(() => {
    let alive = true
    getHealthRows().then(r => { if (alive) { setRows(r); setLoaded(true) } })

    // A fresh sync should refresh us — invalidate cache then refetch.
    const onSync = (e) => {
      if (e?.detail?.status !== 'synced') return
      healthCache.ts = 0
      getHealthRows().then(r => { if (alive) { setRows(r); setLoaded(true) } })
    }
    window.addEventListener('gfit-sync-status', onSync)
    return () => { alive = false; window.removeEventListener('gfit-sync-status', onSync) }
  }, [])

  const scored = (rows || []).filter(r => r.sleep_score != null)
  const last = scored[scored.length - 1] || null
  const avg = scored.length ? scored.reduce((s, r) => s + r.sleep_score, 0) / scored.length : null
  const delta = last && avg != null ? Math.round(last.sleep_score - avg) : null

  // ── Empty / not connected ──
  if (loaded && !last) {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-label">Sleep</div>
        <div style={{ ...HERO, color: 'var(--text-tertiary)', marginTop: 6 }}>—</div>
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>
          Connect Google Health in Settings
        </div>
      </div>
    )
  }

  const deltaEl = delta != null && delta !== 0 ? (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: delta > 0 ? 'var(--success)' : '#E25D7A' }}>
      {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  ) : null

  const hero = (
    <>
      <div className="dash-widget-label">Last Night</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span style={HERO}>{last ? last.sleep_score : '—'}</span>
        {deltaEl}
      </div>
      <div className="dash-widget-label" style={{ marginTop: 3 }}>sleep score</div>
    </>
  )

  // ── S: score + delta ──
  if (size === 'S') {
    return (
      <div style={ROOT_STYLE}>
        {hero}
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>
          {delta == null ? '' : delta > 0 ? 'Above your week.' : delta < 0 ? 'Below your week.' : 'Right on your average.'}
        </div>
      </div>
    )
  }

  // ── M: + HRV & resting-HR pair ──
  if (size === 'M') {
    return (
      <div style={ROOT_STYLE}>
        {hero}
        <div style={{ display: 'flex', gap: 14, marginTop: 'auto', paddingTop: 10 }}>
          <MiniStat label="hrv" value={last?.hrv != null ? Math.round(last.hrv) : '—'} />
          <MiniStat label="resting hr" value={last?.resting_hr != null ? last.resting_hr : '—'} />
        </div>
      </div>
    )
  }

  // ── L: + sparkline + steps/active row ──
  return (
    <div style={ROOT_STYLE}>
      {hero}
      <div style={{ marginTop: 10 }}>
        <Sparkline values={scored.map(r => r.sleep_score)} />
        <div className="dash-widget-label" style={{ marginTop: 2 }}>last 7 nights</div>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 'auto', paddingTop: 10 }}>
        <MiniStat label="hrv" value={last?.hrv != null ? Math.round(last.hrv) : '—'} />
        <MiniStat label="steps" value={fmtNum(last?.steps)} />
        <MiniStat label="active" value={fmtNum(last?.active_minutes)} />
      </div>
    </div>
  )
}
