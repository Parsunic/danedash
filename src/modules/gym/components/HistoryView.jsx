import { useState, useEffect, useCallback, useRef } from 'react'
import { storeGet, storeSet } from '../../../lib/storage.js'
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

function EditWorkoutModal({ log, onSave, onClose }) {
  const totalMs = log.duration || 0
  const initH = Math.floor(totalMs / 3600000)
  const initM = Math.floor((totalMs % 3600000) / 60000)
  const [hours, setHours] = useState(initH)
  const [minutes, setMinutes] = useState(initM)

  const save = () => {
    const newDuration = (hours * 3600 + minutes * 60) * 1000
    onSave({ ...log, duration: newDuration })
  }

  return (
    <div className="gym-modal-overlay open" onClick={e => { if (e.target.classList.contains('gym-modal-overlay')) onClose() }}>
      <div className="gym-modal" style={{ maxWidth: 380 }}>
        <div className="gym-modal-title">
          <span>Edit Workout</span>
          <button className="gym-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="gym-field">
          <label style={{ marginBottom: 6, display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)' }}>
            Workout Duration
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="gym-input"
              type="number" min="0" max="23"
              value={hours}
              onChange={e => setHours(Math.max(0, parseInt(e.target.value) || 0))}
              style={{ width: 72, textAlign: 'center' }}
            />
            <span style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>h</span>
            <input
              className="gym-input"
              type="number" min="0" max="59"
              value={minutes}
              onChange={e => setMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
              style={{ width: 72, textAlign: 'center' }}
            />
            <span style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>m</span>
          </div>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '0 0 16px' }}>
          Adjusting duration for workouts where you forgot to click Finish.
        </p>
        <div className="gym-modal-footer">
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: 2 }} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

function HistorySession({ log, isFirst, onEdit, onResume }) {
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
              {ex.e1rm && <span className="gym-history-ex-e1rm">e1RM <AnimatedNum value={ex.e1rm} /> lbs</span>}
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
        <div className="gym-history-session-actions">
          {isFirst && (
            <button className="btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 12px' }}
              onClick={e => { e.stopPropagation(); onResume(log) }}>
              ▶ Resume
            </button>
          )}
          <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '5px 12px' }}
            onClick={e => { e.stopPropagation(); onEdit(log) }}>
            ✎ Edit
          </button>
        </div>
      </div>
    </div>
  )
}

export default function HistoryView({ onResume }) {
  const [logs, setLogs] = useState(() => (storeGet('gym_workout_logs') || []).slice().reverse())
  const [editLog, setEditLog] = useState(null)

  const reload = useCallback(() => {
    setLogs((storeGet('gym_workout_logs') || []).slice().reverse())
  }, [])

  useEffect(() => {
    window.addEventListener('gym-changed', reload)
    return () => window.removeEventListener('gym-changed', reload)
  }, [reload])

  const handleEditSave = useCallback((updated) => {
    const all = storeGet('gym_workout_logs') || []
    const idx = all.findIndex(l => l.id === updated.id)
    if (idx >= 0) {
      all[idx] = updated
      storeSet('gym_workout_logs', all)
      window.dispatchEvent(new Event('schedule-sync'))
    }
    setEditLog(null)
    reload()
  }, [reload])

  const handleResume = useCallback((log) => {
    if (!onResume) return
    if (!confirm(`Resume "${log.name}"? This will create a new active session with the same exercises.`)) return
    onResume(log)
  }, [onResume])

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
      {logs.map((log, i) => (
        <HistorySession
          key={log.id}
          log={log}
          isFirst={i === 0}
          onEdit={setEditLog}
          onResume={handleResume}
        />
      ))}
      {editLog && (
        <EditWorkoutModal
          log={editLog}
          onSave={handleEditSave}
          onClose={() => setEditLog(null)}
        />
      )}
    </div>
  )
}
