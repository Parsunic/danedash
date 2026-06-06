import { useState, useEffect, useCallback, useRef } from 'react'
import { storeGet } from '../../../lib/storage.js'
import { MONTHS, fmtElapsed } from '../gymUtils.js'

function AnimatedNum({ value, duration = 600 }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef(null)
  useEffect(() => {
    if (!value) { setDisplay(value || 0); return }
    setDisplay(0)
    const start = performance.now()
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1)
      setDisplay(Math.round(t * value))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else setDisplay(value)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value, duration])
  return <>{display}</>
}

function HistorySession({ log }) {
  const [expanded, setExpanded] = useState(false)
  const prNames = (log.exercises || []).filter(ex => ex.sets?.some(s => s.isPR)).map(ex => ex.name)
  const dur = log.duration ? ' · ' + fmtElapsed(log.duration) : ''
  const exC = (log.exercises || []).filter(ex => ex.sets?.length).length
  const setC = (log.exercises || []).reduce((s, ex) => s + (ex.sets?.length || 0), 0)
  const [y, m, d] = log.date.split('-').map(Number)
  const dateStr = `${MONTHS[m - 1]} ${d}, ${y}`

  return (
    <div className={`gym-history-session${expanded ? ' expanded' : ''}`}>
      <div className="gym-history-session-hdr" onClick={() => setExpanded(v => !v)}>
        <div>
          <div className="gym-history-session-name">{log.name}</div>
          <div className="gym-history-session-date">{dateStr}{dur}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="gym-history-session-meta">{exC} ex · {setC} sets</div>
          <div className="gym-history-session-prs">
            {prNames.map(n => <span key={n} className="gym-history-session-pr-chip">★ {n}</span>)}
          </div>
        </div>
      </div>
      <div className="gym-history-session-body">
        {(log.exercises || []).filter(ex => ex.sets?.length).map((ex, i) => (
          <div key={i} className="gym-history-ex">
            <div className="gym-history-ex-name">
              {ex.name}
              {ex.e1rm && <span className="gym-history-ex-e1rm">e1RM {ex.e1rm} lbs</span>}
            </div>
            <div className="gym-history-sets">
              {ex.sets.map((s, si) => (
                <span key={si} className={`gym-history-set-chip${s.isPR ? ' is-pr' : ''}`}>
                  {s.weight}×{s.reps} @{s.rpe}{s.isPR ? ' ★' : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function HistoryView() {
  const [logs, setLogs] = useState(() => (storeGet('gym_workout_logs') || []).slice().reverse())

  const reload = useCallback(() => {
    setLogs((storeGet('gym_workout_logs') || []).slice().reverse())
  }, [])

  useEffect(() => {
    window.addEventListener('gym-changed', reload)
    return () => window.removeEventListener('gym-changed', reload)
  }, [reload])

  if (logs.length === 0) {
    return (
      <div className="gym-placeholder">
        <div className="gym-placeholder-icon">📈</div>
        <div className="gym-placeholder-title">No history yet</div>
        <div className="gym-placeholder-sub">Complete your first workout to see it here.</div>
      </div>
    )
  }

  return (
    <div>
      {logs.map(log => <HistorySession key={log.id} log={log} />)}
    </div>
  )
}
