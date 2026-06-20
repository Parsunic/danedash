import { useState, useCallback, useEffect, useMemo } from 'react'
import { storeGet } from '../../../lib/storage.js'
import { MONTHS } from '../gymUtils.js'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import MuscleMapSection from './MuscleMapSection.jsx'

// ── CONSTANTS ─────────────────────────────────────────────────────────────

const MUSCLE_COLORS = {
  chest: '#E03131', shoulders: '#F59F00', back: '#1971C2',
  biceps: '#7048E8', triceps: '#E8590C', abs: '#20C997',
  core: '#20C997', legs: '#2F9E44', arms: '#E8590C', other: '#555',
}
const ACCENT = '#E8A020'

// ── DATE HELPERS ──────────────────────────────────────────────────────────

function fmtDate(s) {
  if (!s) return ''
  const [, m, d] = s.split('-')
  return `${MONTHS[+m - 1]} ${+d}`
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toDs(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function weekSunday(d) {
  const r = new Date(d)
  r.setDate(r.getDate() - r.getDay())
  r.setHours(0,0,0,0)
  return r
}

// ── DATA BUILDERS ─────────────────────────────────────────────────────────

function buildWeeklyVolume(logs) {
  const now = new Date()
  return Array.from({ length: 8 }, (_, i) => {
    const ws = weekSunday(addDays(now, -(7 - i) * 7))
    const we = addDays(ws, 7)
    const row = { week: `${MONTHS[ws.getMonth()]} ${ws.getDate()}` }
    logs
      .filter(l => { if (!l.date) return false; const d = new Date(l.date+'T00:00:00'); return d >= ws && d < we })
      .forEach(l => (l.exercises||[]).forEach(ex => {
        const m = (ex.primary_muscle||'other').toLowerCase()
        const v = (ex.sets||[]).reduce((s, set) => s + (set.weight||0)*(set.reps||0), 0)
        row[m] = (row[m]||0) + v
      }))
    return row
  })
}

function buildHeatmap(logs) {
  const vbd = {}
  const cutoff = addDays(new Date(), -182)
  logs.forEach(l => {
    if (!l.date || new Date(l.date+'T00:00:00') < cutoff) return
    const v = (l.exercises||[]).reduce((s, ex) =>
      s + (ex.sets||[]).reduce((s2, set) => s2 + (set.weight||0)*(set.reps||0), 0), 0)
    vbd[l.date] = (vbd[l.date]||0) + v
  })
  return vbd
}

function buildPRs(hist) {
  const prs = []
  Object.entries(hist).forEach(([name, data]) => {
    let best = 0
    ;(data.sessions||[]).forEach(s => {
      if ((s.e1rm||0) > best) {
        best = s.e1rm
        prs.push({ date: s.date, name, weight: s.weight, reps: s.reps, e1rm: s.e1rm })
      }
    })
  })
  return prs.sort((a, b) => a.date.localeCompare(b.date)).slice(-20)
}

function buildVolMap(logs) {
  const map = {}
  logs.forEach(l => (l.exercises||[]).forEach(ex => {
    if (!map[ex.name]) map[ex.name] = []
    const v = (ex.sets||[]).reduce((s, set) => s + (set.weight||0)*(set.reps||0), 0)
    if (v > 0) map[ex.name].push({ date: l.date, vol: v })
  }))
  Object.keys(map).forEach(k => {
    map[k] = map[k].sort((a, b) => a.date.localeCompare(b.date)).slice(-30)
  })
  return map
}

// ── TOOLTIPS ──────────────────────────────────────────────────────────────

function GlassTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="gym-chart-tt">
      <div className="gym-chart-tt-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="gym-chart-tt-row">
          <span className="gym-chart-tt-dot" style={{ background: p.color||ACCENT }} />
          <span>{p.name}: <strong>{typeof p.value==='number' ? Math.round(p.value).toLocaleString() : p.value}</strong></span>
        </div>
      ))}
    </div>
  )
}

function E1RMTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="gym-chart-tt">
      <div className="gym-chart-tt-label">{label}</div>
      <div className="gym-chart-tt-row">
        <span className="gym-chart-tt-dot" style={{ background: ACCENT }} />
        <span>e1RM: <strong>{Math.round(d?.e1rm||0)} lbs</strong></span>
      </div>
      <div className="gym-chart-tt-sub">{d?.weight} lbs × {d?.reps} reps @ RPE {d?.rpe}</div>
    </div>
  )
}

// ── HEATMAP ───────────────────────────────────────────────────────────────

function WorkoutHeatmap({ logs }) {
  const vbd = useMemo(() => buildHeatmap(logs), [logs])
  const now = new Date()
  const todayDs = toDs(now)
  const gs = weekSunday(addDays(now, -181))

  const weeks = useMemo(() => {
    const result = []
    let d = new Date(gs)
    while (toDs(d) <= todayDs) {
      const week = []
      for (let i = 0; i < 7; i++) {
        const day = addDays(d, i)
        const ds = toDs(day)
        if (ds > todayDs) break
        week.push({ ds, vol: vbd[ds]||0 })
      }
      if (week.length) result.push(week)
      d = addDays(d, 7)
    }
    return result
  }, [vbd, todayDs])

  const maxVol = Math.max(...Object.values(vbd), 1)
  const color = v => {
    if (!v) return '#1c1c22'
    const t = v / maxVol
    if (t < 0.2)  return 'rgba(232,160,32,0.28)'
    if (t < 0.45) return 'rgba(232,160,32,0.52)'
    if (t < 0.72) return 'rgba(232,160,32,0.76)'
    return ACCENT
  }

  const CELL=11, STEP=13, LP=16, TP=14
  const svgW = weeks.length * STEP + LP
  const svgH = 7 * STEP + TP
  const DOW = ['S','M','T','W','T','F','S']

  const mLabels = []
  weeks.forEach((wk, wi) => {
    if (!wk[0]) return
    const fd = new Date(wk[0].ds+'T00:00:00')
    const prevFd = wi > 0 && weeks[wi-1]?.[0] ? new Date(weeks[wi-1][0].ds+'T00:00:00') : null
    if (fd.getDate() <= 7 && (!prevFd || prevFd.getMonth() !== fd.getMonth())) {
      mLabels.push({ x: wi*STEP+LP, label: MONTHS[fd.getMonth()] })
    }
  })

  return (
    <div className="gym-heatmap-outer">
      <svg width={svgW} height={svgH} style={{ display:'block', overflow:'visible' }}>
        {mLabels.map((m, i) => (
          <text key={i} x={m.x} y={9} fontSize={8.5} fill="rgba(255,255,255,0.4)"
            fontFamily="var(--font-body)">{m.label}</text>
        ))}
        {[1,3,5].map(di => (
          <text key={di} x={0} y={TP + di*STEP + CELL - 1} fontSize={7.5}
            fill="rgba(255,255,255,0.3)" fontFamily="var(--font-body)">{DOW[di]}</text>
        ))}
        {weeks.map((wk, wi) =>
          wk.map((cell, di) => (
            <rect key={`${wi}-${di}`}
              x={wi*STEP+LP} y={TP + di*STEP}
              width={CELL} height={CELL} rx={2} fill={color(cell.vol)}>
              <title>{cell.ds}{cell.vol ? ` · ${Math.round(cell.vol).toLocaleString()} vol` : ''}</title>
            </rect>
          ))
        )}
      </svg>
    </div>
  )
}

// ── PR TIMELINE ────────────────────────────────────────────────────────────

function PRTimeline({ hist }) {
  const prs = useMemo(() => buildPRs(hist), [hist])
  if (!prs.length) return <div className="gym-chart-empty">Log workouts to build your PR timeline.</div>

  return (
    <div className="gym-pr-outer">
      <div className="gym-pr-track">
        {prs.map((pr, i) => (
          <div key={i} className="gym-pr-item">
            <div className="gym-pr-dot" />
            <div className="gym-pr-name">{pr.name}</div>
            <div className="gym-pr-weight">{pr.weight} lbs</div>
            <div className="gym-pr-date-label">{fmtDate(pr.date)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── SUMMARY SECTION ────────────────────────────────────────────────────────

function SummarySection({ logs, hist }) {
  const wvData = useMemo(() => buildWeeklyVolume(logs), [logs])
  const activeMuscles = useMemo(() => {
    const seen = new Set()
    wvData.forEach(row => Object.keys(MUSCLE_COLORS).forEach(m => { if (row[m] > 0) seen.add(m) }))
    return [...seen]
  }, [wvData])

  const hasAnyData = logs.length > 0 || Object.keys(hist).length > 0
  if (!hasAnyData) return null

  return (
    <div className="gym-stats-summary">
      <div className="gym-stats-summary-card">
        <div className="gym-stats-summary-title">Weekly Volume by Muscle</div>
        {!logs.length ? (
          <div className="gym-chart-empty">No workout logs yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={wvData} margin={{ top:4, right:8, left:-22, bottom:0 }} barCategoryGap="18%">
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="week"
                tick={{ fontSize:9, fill:'rgba(255,255,255,0.38)', fontFamily:'var(--font-body)' }}
                axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip content={<GlassTooltip />} cursor={{ fill:'rgba(255,255,255,0.04)' }} />
              {activeMuscles.map((m, mi) => (
                <Bar key={m} dataKey={m} stackId="a" fill={MUSCLE_COLORS[m]}
                  radius={mi === activeMuscles.length-1 ? [3,3,0,0] : [0,0,0,0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="gym-stats-summary-card">
        <div className="gym-stats-summary-title">Workout Frequency — 6 months</div>
        <WorkoutHeatmap logs={logs} />
      </div>

      <div className="gym-stats-summary-card">
        <div className="gym-stats-summary-title">PR Timeline</div>
        <PRTimeline hist={hist} />
      </div>
    </div>
  )
}

// ── EXERCISE STAT CARD ─────────────────────────────────────────────────────

function ExerciseStatCard({ name, data, volData }) {
  const sessions = data?.sessions || []
  const pr = data?.allTimePR
  const last = sessions[sessions.length - 1]
  const gid = name.replace(/[^a-z0-9]/gi, '-')

  const e1rmChartData = useMemo(() =>
    sessions.slice(-30).map(s => ({
      date: fmtDate(s.date), e1rm: s.e1rm||0,
      weight: s.weight, reps: s.reps, rpe: s.rpe,
    })), [sessions])

  const volChartData = useMemo(() =>
    (volData||[]).map(v => ({ date: fmtDate(v.date), vol: Math.round(v.vol) })),
  [volData])

  const hasE1rm = e1rmChartData.length > 1 && e1rmChartData.some(d => d.e1rm > 0)
  const hasVol  = volChartData.length > 1

  return (
    <div className="gym-stats-exercise-card">
      <div className="gym-stats-ex-header">
        <div className="gym-stats-ex-name">{name}</div>
        <div className="gym-stats-ex-badges">
          {pr != null && <span className="gym-stats-ex-pr">PR {pr} lbs</span>}
          <span className="gym-stats-ex-count">{sessions.length} session{sessions.length!==1?'s':''}</span>
        </div>
      </div>
      {last && (
        <div className="gym-stats-ex-last">
          Last: {last.date} · {last.weight}×{last.reps} @ RPE {last.rpe}
        </div>
      )}

      {hasE1rm && (
        <div className="gym-stats-chart-section">
          <div className="gym-stats-chart-label">e1RM Progression</div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={e1rmChartData} margin={{ top:8, right:8, left:-28, bottom:0 }}>
              <defs>
                <linearGradient id={`eg-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#F89F00" stopOpacity={0.75} />
                  <stop offset="95%" stopColor="#F89F00" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date"
                tick={{ fontSize:9, fill:'rgba(255,255,255,0.35)', fontFamily:'var(--font-body)' }}
                axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize:9, fill:'rgba(255,255,255,0.35)', fontFamily:'var(--font-body)' }}
                axisLine={false} tickLine={false} width={32} />
              <Tooltip content={<E1RMTooltip />} cursor={{ stroke:'rgba(232,160,32,0.25)', strokeWidth:1 }} />
              <Area type="monotone" dataKey="e1rm" name="e1RM" stroke={ACCENT} strokeWidth={2}
                fill={`url(#eg-${gid})`} dot={false}
                activeDot={{ r:4, fill:ACCENT, strokeWidth:0 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasVol && (
        <div className="gym-stats-chart-section" style={{ marginTop: hasE1rm ? 6 : 14 }}>
          <div className="gym-stats-chart-label">Session Volume (lbs)</div>
          <ResponsiveContainer width="100%" height={72}>
            <BarChart data={volChartData} margin={{ top:2, right:8, left:-28, bottom:0 }}>
              <defs>
                <linearGradient id={`vg-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={ACCENT} stopOpacity={0.65} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Tooltip content={<GlassTooltip />} cursor={{ fill:'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="vol" name="volume" fill={`url(#vg-${gid})`} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!hasE1rm && !hasVol && sessions.length > 0 && (
        <div className="gym-stats-chart-label" style={{ marginTop:10, opacity:0.45 }}>
          Need more sessions to show charts
        </div>
      )}
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────────────

export default function StatsView() {
  const [search, setSearch] = useState('')
  const [hist, setHist] = useState(() => storeGet('gym_exercise_history') || {})
  const [logs, setLogs] = useState(() => storeGet('gym_workout_logs') || [])

  const reload = useCallback(() => {
    setHist(storeGet('gym_exercise_history') || {})
    setLogs(storeGet('gym_workout_logs') || [])
  }, [])

  useEffect(() => {
    window.addEventListener('gym-changed', reload)
    return () => window.removeEventListener('gym-changed', reload)
  }, [reload])

  const volMap = useMemo(() => buildVolMap(logs), [logs])

  const allEx = Object.keys(hist)
  const filtered = search.trim()
    ? allEx.filter(n => n.toLowerCase().includes(search.toLowerCase()))
    : allEx

  return (
    <div className="gym-stats-view">
      <SummarySection logs={logs} hist={hist} />

      <div className="gym-stats-search-wrap" style={{ marginTop: 20 }}>
        <span className="gym-stats-search-icon">⌕</span>
        <input
          className="gym-stats-search"
          placeholder="Search exercises…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button className="gym-stats-search-clear" onClick={() => setSearch('')}>✕</button>}
      </div>

      {filtered.length === 0 ? (
        <div className="gym-placeholder">
          <div className="gym-placeholder-icon">📊</div>
          <div className="gym-placeholder-title">{search ? 'No matching exercises' : 'No data yet'}</div>
          <div className="gym-placeholder-sub">
            {search ? 'Try a different search.' : 'Log workouts on mobile to see stats here.'}
          </div>
        </div>
      ) : (
        <div className="gym-stats-exercise-list">
          {filtered.map(name => (
            <ExerciseStatCard
              key={name}
              name={name}
              data={hist[name]}
              volData={volMap[name]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
