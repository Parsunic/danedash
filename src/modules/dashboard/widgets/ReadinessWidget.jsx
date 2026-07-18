import { useState, useEffect, useMemo } from 'react'
import { getHealthRows, peekHealthRows, invalidateHealthCache } from './healthData.js'
import { storeGet } from '../../../lib/storage.js'
import {
  localTodayStr, computeBaselines, computeReadiness, readinessParts,
  trainingVerdict, verdictInputs,
} from '../../health/readinessUtils.js'

// Readiness widget — today's training readiness (the same number as /health's
// Overview ring: readinessUtils carries the exact formula) plus the
// train-hard / steady / go-easy verdict. Health rows come from the shared
// dashboard cache (healthData.js) so the dashboard makes at most ONE health
// fetch regardless of how many widgets read it; gym volume is derived from
// gym_workout_logs at render time and never persisted.

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const HERO = { fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 40, lineHeight: 1, color: 'var(--text-primary)' }

const VERDICT_COLORS = {
  'Train hard': 'var(--success)',
  'Steady':     'var(--accent)',
  'Go easy':    '#7048E8',
}

function readGymLogs() {
  return storeGet('gym_workout_logs') ?? []
}

function MiniStat({ label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color: 'var(--text-primary)' }}>{value}</div>
      <div className="dash-widget-label" style={{ marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function ReadinessWidget({ size }) {
  const [rows, setRows] = useState(() => peekHealthRows() || null)
  const [loaded, setLoaded] = useState(() => !!peekHealthRows())
  const [logs, setLogs] = useState(readGymLogs)

  useEffect(() => {
    let alive = true
    getHealthRows().then(r => { if (alive) { setRows(r); setLoaded(true) } })

    // A fresh Google Health sync should refresh us — invalidate then refetch.
    const onSync = (e) => {
      if (e?.detail?.status !== 'synced') return
      invalidateHealthCache()
      getHealthRows().then(r => { if (alive) { setRows(r); setLoaded(true) } })
    }
    // Gym edits / remote sync change yesterday's volume → re-read (compare
    // first so sync-applied storms don't re-render for identical data).
    const onGym = () => setLogs(prev => {
      const next = readGymLogs()
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
    })
    window.addEventListener('gfit-sync-status', onSync)
    window.addEventListener('gym-changed', onGym)
    window.addEventListener('sync-applied', onGym)
    return () => {
      alive = false
      window.removeEventListener('gfit-sync-status', onSync)
      window.removeEventListener('gym-changed', onGym)
      window.removeEventListener('sync-applied', onGym)
    }
  }, [])

  const history = rows || []
  const todayRow = history.find(r => r.date === localTodayStr()) ?? null
  const baselines = computeBaselines(history)
  const readiness = computeReadiness(todayRow, baselines)
  const inputs = useMemo(() => verdictInputs(logs), [logs])
  const { verdict, reason } = trainingVerdict({ todayReadiness: readiness, ...inputs })

  // ── Empty / not connected / no row yet today ──
  if (loaded && readiness == null) {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-label">Readiness</div>
        <div style={{ ...HERO, color: 'var(--text-tertiary)', marginTop: 6 }}>—</div>
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>
          {history.length ? 'No readiness data yet today.' : 'Connect Google Health in Settings'}
        </div>
      </div>
    )
  }

  const verdictColor = VERDICT_COLORS[verdict] ?? 'var(--text-tertiary)'
  const hero = (
    <>
      <div className="dash-widget-label">Readiness</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
        <span style={HERO}>{readiness ?? '—'}</span>
        {readiness != null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-tertiary)' }}>%</span>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: verdictColor, marginTop: 4 }}>
        {verdict ?? '—'}
      </div>
    </>
  )

  // ── S: readiness hero + verdict word ──
  if (size === 'S') {
    return <div style={ROOT_STYLE}>{hero}</div>
  }

  // ── M: + reason micro-copy + sleep/HRV/RHR contribution row ──
  const parts = readinessParts(todayRow, baselines)
  const fmtPart = v => (v == null ? '—' : String(Math.round(v)))
  return (
    <div style={ROOT_STYLE}>
      {hero}
      {reason && (
        <div className="dash-widget-empty" style={{ marginTop: 6, padding: 0, textAlign: 'left' }}>
          {reason}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, marginTop: 'auto', paddingTop: 10 }}>
        <MiniStat label="sleep" value={fmtPart(parts.sleep)} />
        <MiniStat label="hrv" value={fmtPart(parts.hrv)} />
        <MiniStat label="rhr" value={fmtPart(parts.rhr)} />
      </div>
    </div>
  )
}
