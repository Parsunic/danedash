import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { storeGet } from '../../../lib/storage.js'
import { getActiveDateString } from '../../../lib/dateHelpers.js'
import { getExRec, fmtElapsed } from '../gymUtils.js'
import { searchExercises } from '../../../lib/muscleUtils.js'

// ── ANIMATED NUMBER ───────────────────────────────────────────────────────

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

// ── HELPERS ───────────────────────────────────────────────────────────────

function getMostNeglectedMuscle() {
  const logs = storeGet('gym_workout_logs') || []
  const now = Date.now()
  const MUSCLES = ['chest', 'back', 'legs', 'shoulders', 'core', 'arms']
  const lastTrained = {}
  logs.forEach(log => {
    const t = log.completedAt ? new Date(log.completedAt).getTime() : 0
    ;(log.exercises || []).forEach(ex => {
      const m = (ex.primary_muscle || '').toLowerCase()
      if (MUSCLES.includes(m) && t > (lastTrained[m] || 0)) lastTrained[m] = t
    })
  })
  let neglected = null, oldest = Infinity
  MUSCLES.forEach(m => {
    const t = lastTrained[m] || 0
    if (t < oldest) { oldest = t; neglected = m }
  })
  if (!neglected) return null
  return { muscle: neglected, daysAgo: oldest === 0 ? null : Math.floor((now - oldest) / 86400000) }
}

// ── RPE COMPONENTS ────────────────────────────────────────────────────────

function RPEStrip({ selected, onSelect, highlight }) {
  return (
    <div className="rpe-strip">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(r => (
        <button
          key={r}
          className={`rpe-btn${selected === r ? ' selected' : ''}`}
          style={highlight && r === 1 ? { outline: '2px solid var(--danger)' } : {}}
          onClick={() => onSelect(r)}
        >{r}</button>
      ))}
    </div>
  )
}

function RPESelect({ value, onChange, highlight }) {
  return (
    <select
      className={`rpe-compact-select${highlight ? ' highlight' : ''}`}
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? +e.target.value : null)}
    >
      <option value="">RPE</option>
      {Array.from({ length: 10 }, (_, i) => i + 1).map(r => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  )
}

// ── SET ROW ───────────────────────────────────────────────────────────────

function SetRow({ setNum, row, isTemplate, onChange, onLog, onRemove, canRemove }) {
  const [rpeHigh, setRpeHigh] = useState(false)

  const attempt = () => {
    const w = parseFloat(row.weight), r = parseInt(row.reps)
    if (!w || w <= 0 || !r || r <= 0) return
    if (!row.rpe) {
      setRpeHigh(true)
      setTimeout(() => setRpeHigh(false), 1400)
      return
    }
    onLog(w, r, row.rpe)
  }

  if (isTemplate) {
    return (
      <div className="gym-set-row-compact">
        <span className="gym-set-row-label">Set {setNum}</span>
        <input
          type="text" inputMode="decimal" placeholder={row.phWeight || 'lbs'}
          className="gym-set-compact-input"
          value={row.weight}
          onChange={e => onChange('weight', e.target.value)}
        />
        <input
          type="text" inputMode="numeric" placeholder={row.phReps || 'reps'}
          className="gym-set-compact-input"
          value={row.reps}
          onChange={e => onChange('reps', e.target.value)}
        />
        <RPESelect value={row.rpe} onChange={v => onChange('rpe', v)} highlight={rpeHigh} />
        <button className="btn-ghost" style={{ padding: '7px 12px', fontSize: '0.8125rem', color: 'var(--accent)', borderColor: 'rgba(232,160,32,0.3)' }} onClick={attempt}>✓</button>
        {canRemove && <button className="gym-set-remove-btn" onClick={onRemove}>×</button>}
      </div>
    )
  }

  return (
    <div className="gym-new-set-row">
      <div className="gym-new-set-field">
        <div className="gym-new-set-label">Set {setNum} · lbs</div>
        <input
          type="number" inputMode="decimal" placeholder="135"
          className="gym-new-set-input"
          value={row.weight}
          onChange={e => onChange('weight', e.target.value)}
        />
      </div>
      <div className="gym-new-set-field">
        <div className="gym-new-set-label">Reps</div>
        <input
          type="number" inputMode="numeric" placeholder="8"
          className="gym-new-set-input"
          value={row.reps}
          onChange={e => onChange('reps', e.target.value)}
        />
      </div>
      <div className="gym-new-set-field">
        <div className="gym-new-set-label">RPE</div>
        <RPEStrip selected={row.rpe} onSelect={v => onChange('rpe', v)} highlight={rpeHigh} />
      </div>
      <button className="btn-ghost" style={{ alignSelf: 'flex-end', color: 'var(--accent)', borderColor: 'rgba(232,160,32,0.3)' }} onClick={attempt}>✓ Log</button>
      {canRemove && <button className="gym-set-remove-btn" onClick={onRemove}>×</button>}
    </div>
  )
}

// ── EXERCISE CARD ─────────────────────────────────────────────────────────

function ExerciseCard({ ex, exIdx, isTemplate, inputRows, exHistory, onInputChange, onLogSet, onAddRow, onRemoveRow, isActiveCard }) {
  const rec = getExRec(ex.name, ex.repRange, exHistory)
  const loggedCount = ex.sets.length
  const totalTarget = ex.targetSets || 0

  return (
    <div className={`gym-log-exercise-card${isActiveCard ? ' card-breathing' : ''}`}>
      <div className="gym-log-ex-header">
        <div className="gym-log-ex-name">{ex.name}</div>
        {totalTarget > 0 && (
          <div className={`gym-log-ex-progress${loggedCount >= totalTarget ? ' done' : ''}`}>
            {loggedCount}/{totalTarget}
          </div>
        )}
      </div>
      <div className="gym-log-po-rec">
        {rec.seed
          ? <span className="po-seed">No history — enter a working weight to seed the engine</span>
          : (
            <>
              {rec.e1rmStr}{rec.lastStr}
              <br />
              <span className="po-suggest">
                → Try <strong>{rec.sW} lbs × {rec.sR}</strong>{' '}
                <span className={`po-tag${rec.tc ? ' ' + rec.tc : ''}`}>{rec.tag}</span>
              </span>
            </>
          )}
      </div>

      {loggedCount > 0 && (
        <table className="gym-sets-table">
          <thead>
            <tr><th>Set</th><th>Weight</th><th>Reps</th><th>RPE</th><th></th></tr>
          </thead>
          <tbody>
            {ex.sets.map((s, si) => (
              <tr key={si} className={`gym-set-row${s.isPR ? ' is-pr' : ''}`}>
                <td className="gym-set-num">{si + 1}</td>
                <td className="gym-set-val">{s.weight}</td>
                <td className="gym-set-val">{s.reps}</td>
                <td className="gym-set-val"><span className="gym-set-rpe-badge">{s.rpe}</span></td>
                <td className="gym-set-val">{s.isPR && <span className="gym-set-pr-badge">★ PR</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {inputRows.map((row, ri) => (
        <SetRow
          key={ri}
          setNum={loggedCount + ri + 1}
          row={row}
          isTemplate={isTemplate}
          onChange={(field, val) => onInputChange(exIdx, ri, field, val)}
          onLog={(w, r, rpe) => onLogSet(exIdx, ri, w, r, rpe)}
          onRemove={() => onRemoveRow(exIdx, ri)}
          canRemove={isTemplate || inputRows.length > 1}
        />
      ))}

      {inputRows.length === 0 && (
        <div className="gym-sets-done-hint">
          {loggedCount} {loggedCount === 1 ? 'set' : 'sets'} logged
        </div>
      )}

      <button className="gym-add-set-btn" onClick={() => onAddRow(exIdx)}>+ Add Set</button>
    </div>
  )
}

// ── LOG IDLE ──────────────────────────────────────────────────────────────

function LogIdle({ onStartWorkout }) {
  const todayStr = getActiveDateString()
  const pw = (storeGet('gym_planned') || []).find(p => p.date === todayStr)
  const templates = storeGet('gym_templates') || []
  const [selTpl, setSelTpl] = useState('')
  const [mode, setMode] = useState('idle')

  // Freestyle state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [addedExs, setAddedExs] = useState([])
  const [neglect, setNeglect] = useState(null)
  const searchTimer = useRef(null)

  useEffect(() => {
    if (mode === 'freestyle') setNeglect(getMostNeglectedMuscle())
  }, [mode])

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const data = await searchExercises(query)
      setResults(data)
      setSearching(false)
    }, 300)
    return () => clearTimeout(searchTimer.current)
  }, [query])

  const addEx = useCallback(ex => {
    setAddedExs(prev => prev.some(e => e.name === ex.name) ? prev : [...prev, { ...ex, targetSets: 3 }])
    setQuery('')
    setResults([])
  }, [])

  const startFreestyle = useCallback(() => {
    if (!addedExs.length) return
    const exercises = addedExs.map(e => ({ name: e.name, repRange: '8-10', notes: '', sets: e.targetSets }))
    onStartWorkout(exercises, null, 'Freestyle Workout', false)
  }, [addedExs, onStartWorkout])

  if (mode === 'freestyle') {
    return (
      <div className="gym-log-idle">
        <button className="gym-back-btn" onClick={() => setMode('idle')}>← Back</button>
        <div className="gym-log-idle-title" style={{ marginTop: 10 }}>Freestyle Workout</div>

        <div className="gym-ex-search-wrap">
          <input
            className="gym-ex-search"
            placeholder="Search exercises..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          {searching && <span className="gym-ex-search-spinner">···</span>}
        </div>

        {neglect && (
          <div className="gym-neglect-hint">
            {neglect.daysAgo === null
              ? `Haven't trained ${neglect.muscle} yet — consider adding some today`
              : `Haven't trained ${neglect.muscle} in ${neglect.daysAgo} ${neglect.daysAgo === 1 ? 'day' : 'days'}`}
          </div>
        )}

        {results.length > 0 && (
          <div className="gym-ex-results">
            {results.map(r => (
              <button key={r.name} className="gym-ex-result-row" onClick={() => addEx(r)}>
                <span className="gym-ex-result-name">{r.name}</span>
                {r.primary_muscle && (
                  <span className={`gym-muscle-badge muscle-${r.primary_muscle}`}>{r.primary_muscle}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {addedExs.length > 0 && (
          <div className="gym-added-exs">
            <div className="gym-section-micro">Added</div>
            {addedExs.map((ex, i) => (
              <div key={ex.name} className="gym-added-ex-row">
                <div className="gym-added-ex-info">
                  <span className="gym-added-ex-name">{ex.name}</span>
                  {ex.primary_muscle && (
                    <span className={`gym-muscle-badge muscle-${ex.primary_muscle}`}>{ex.primary_muscle}</span>
                  )}
                </div>
                <div className="gym-sets-stepper">
                  <button onClick={() => setAddedExs(p => p.map((e, j) => j === i ? { ...e, targetSets: Math.max(1, e.targetSets - 1) } : e))}>−</button>
                  <span>{ex.targetSets}</span>
                  <button onClick={() => setAddedExs(p => p.map((e, j) => j === i ? { ...e, targetSets: Math.min(10, e.targetSets + 1) } : e))}>+</button>
                </div>
                <button className="gym-ex-remove-btn" onClick={() => setAddedExs(p => p.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
        )}

        <button
          className="btn-primary"
          disabled={!addedExs.length}
          style={{ width: '100%', padding: 14, fontSize: 15, marginTop: 20, opacity: addedExs.length ? 1 : 0.4 }}
          onClick={startFreestyle}
        >▶ Start Freestyle Workout</button>
      </div>
    )
  }

  if (pw && pw.status !== 'completed') {
    return (
      <div className="gym-log-idle">
        <div className="gym-log-idle-title">{pw.name}</div>
        <div className="gym-log-idle-sub">Today's planned workout</div>
        {pw.exercises.length > 0 && (
          <ul className="gym-log-planned-exercises">
            {pw.exercises.map((ex, i) => (
              <li key={i} className="gym-log-planned-ex">
                <span>{ex.name}</span>
                <span className="gym-log-planned-ex-meta">{ex.sets}×{ex.repRange || '—'}</span>
              </li>
            ))}
          </ul>
        )}
        <button className="btn-primary" style={{ width: '100%', padding: 14, fontSize: 15 }}
          onClick={() => onStartWorkout(pw.exercises, pw.id, pw.name, true)}>
          ▶ Start Workout
        </button>
        <button className="btn-secondary" style={{ width: '100%', marginTop: 8 }}
          onClick={() => setMode('freestyle')}>
          ⚡ Freestyle Instead
        </button>
      </div>
    )
  }

  if (pw && pw.status === 'completed') {
    return (
      <div className="gym-log-idle">
        <div className="gym-log-idle-title">✓ {pw.name}</div>
        <div className="gym-log-idle-sub">Today's workout already logged.</div>
        <button className="btn-secondary" style={{ marginTop: 12 }}
          onClick={() => onStartWorkout(pw.exercises, null, pw.name + ' (extra)', true)}>
          Log Another Session
        </button>
        <button className="btn-secondary" style={{ marginTop: 8 }}
          onClick={() => setMode('freestyle')}>
          ⚡ Freestyle Workout
        </button>
      </div>
    )
  }

  return (
    <div className="gym-log-idle">
      <div className="gym-log-idle-title">No workout scheduled today</div>
      <div className="gym-log-idle-sub">Pick a template or build your own.</div>
      {templates.length > 0 && (
        <>
          <select className="gym-input" style={{ margin: '12px 0' }} value={selTpl} onChange={e => setSelTpl(e.target.value)}>
            <option value="">— Pick a template —</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button
            className="btn-primary"
            style={{ width: '100%', padding: 14, fontSize: 15, opacity: selTpl ? 1 : 0.4 }}
            disabled={!selTpl}
            onClick={() => {
              const t = templates.find(x => x.id === selTpl)
              if (t) onStartWorkout(t.exercises, null, t.name, true)
            }}
          >▶ Start Workout</button>
        </>
      )}
      <button
        className="btn-primary"
        style={{ width: '100%', padding: 14, fontSize: 15, marginTop: 10, background: 'rgba(107,227,164,0.1)', borderColor: 'rgba(107,227,164,0.25)', color: 'var(--success)' }}
        onClick={() => setMode('freestyle')}
      >⚡ Freestyle Workout</button>
    </div>
  )
}

// ── MAIN LogView ──────────────────────────────────────────────────────────

export default function LogView({ activeSession, onLogSet, onFinish, onStartWorkout }) {
  const [exHistory, setExHistory] = useState(() => storeGet('gym_exercise_history') || {})
  const [elapsed, setElapsed] = useState(0)
  const [inputs, setInputs] = useState({}) // { [exIdx]: [{ weight, reps, rpe }] }
  const timerRef = useRef(null)

  useEffect(() => {
    const reload = () => setExHistory(storeGet('gym_exercise_history') || {})
    window.addEventListener('gym-changed', reload)
    return () => window.removeEventListener('gym-changed', reload)
  }, [])

  useEffect(() => {
    clearInterval(timerRef.current)
    if (activeSession) {
      setElapsed(Date.now() - activeSession.startedAt)
      timerRef.current = setInterval(() => setElapsed(Date.now() - activeSession.startedAt), 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [activeSession])

  // Initialize input rows when session starts or exercises are added
  useEffect(() => {
    if (!activeSession) { setInputs({}); return }
    const hist = storeGet('gym_exercise_history') || {}
    setInputs(prev => {
      const next = { ...prev }
      activeSession.exercises.forEach((ex, i) => {
        if (next[i]) return
        const rec = getExRec(ex.name, ex.repRange, hist)
        const sessions = hist[ex.name]?.sessions
        const last = sessions && sessions.length > 0 ? sessions[sessions.length - 1] : null
        const defRow = {
          weight: last ? String(last.weight) : '',
          reps: last ? String(last.reps) : '',
          rpe: null,
          phWeight: rec.suggest ? String(rec.suggest.weight) : '',
          phReps: rec.suggest ? String(rec.suggest.reps) : '',
        }
        if (activeSession.isTemplate) {
          next[i] = Array.from({ length: ex.targetSets }, () => ({ ...defRow }))
        } else {
          next[i] = [{ ...defRow }]
        }
      })
      return next
    })
  }, [activeSession])

  const handleInputChange = useCallback((ei, ri, field, val) => {
    setInputs(prev => {
      const rows = [...(prev[ei] || [])]
      rows[ri] = { ...(rows[ri] || {}), [field]: val }
      return { ...prev, [ei]: rows }
    })
  }, [])

  const handleLogSet = useCallback((ei, ri, weight, reps, rpe) => {
    onLogSet(ei, weight, reps, rpe)
    setInputs(prev => {
      if (activeSession?.isTemplate) {
        return { ...prev, [ei]: (prev[ei] || []).filter((_, i) => i !== ri) }
      }
      const rows = [...(prev[ei] || [])]
      rows[ri] = { weight: String(weight), reps: '', rpe: null }
      return { ...prev, [ei]: rows }
    })
  }, [onLogSet, activeSession])

  const handleAddRow = useCallback((ei) => {
    const ex = activeSession?.exercises[ei]
    if (!ex) return
    const rec = getExRec(ex.name, ex.repRange, exHistory)
    const sessions = exHistory[ex.name]?.sessions
    const last = sessions && sessions.length > 0 ? sessions[sessions.length - 1] : null
    const newRow = {
      weight: last ? String(last.weight) : '',
      reps: last ? String(last.reps) : '',
      rpe: null,
      phWeight: rec.suggest ? String(rec.suggest.weight) : '',
      phReps: rec.suggest ? String(rec.suggest.reps) : '',
    }
    setInputs(prev => ({ ...prev, [ei]: [...(prev[ei] || []), newRow] }))
  }, [activeSession, exHistory])

  const handleRemoveRow = useCallback((ei, ri) => {
    setInputs(prev => ({ ...prev, [ei]: (prev[ei] || []).filter((_, i) => i !== ri) }))
  }, [])

  if (!activeSession) {
    return <LogIdle onStartWorkout={onStartWorkout} />
  }

  return (
    <div>
      <div className="gym-session-header">
        <div>
          <div className="gym-session-name">{activeSession.name}</div>
          <div className="gym-session-timer">{fmtElapsed(elapsed)}</div>
        </div>
        <button className="btn-primary" style={{ background: 'linear-gradient(135deg,#6BE3A4 0%,#3dba7e 100%)', color: '#050506' }} onClick={onFinish}>✓ Finish</button>
      </div>
      {activeSession.exercises.map((ex, ei) => (
        <ExerciseCard
          key={ei}
          ex={ex}
          exIdx={ei}
          isTemplate={activeSession.isTemplate}
          inputRows={inputs[ei] || []}
          exHistory={exHistory}
          onInputChange={handleInputChange}
          onLogSet={handleLogSet}
          onAddRow={handleAddRow}
          onRemoveRow={handleRemoveRow}
        />
      ))}
    </div>
  )
}
