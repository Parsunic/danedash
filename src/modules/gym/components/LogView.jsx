import { useState, useEffect, useCallback, useRef } from 'react'
import { storeGet } from '../../../lib/storage.js'
import { getActiveDateString } from '../../../lib/dateHelpers.js'
import { getExRec, fmtElapsed, getWeightUnit } from '../gymUtils.js'
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
  const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core']
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

// ── RPE SELECT ────────────────────────────────────────────────────────────

function RPESelect({ value, onChange }) {
  return (
    <select
      className="rpe-compact-select"
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

// ── SET INPUT ROW ─────────────────────────────────────────────────────────

function SetInputRow({ setNum, row, onChange, onRemove, canRemove, repPlaceholder = 'reps' }) {
  const unit = getWeightUnit()
  return (
    <div className="gym-set-row-compact">
      <span className="gym-set-row-label">Set {setNum}</span>
      <input
        type="text" inputMode="decimal" placeholder={unit}
        className="gym-set-compact-input"
        value={row.weight}
        onChange={e => onChange('weight', e.target.value)}
      />
      <input
        type="text" inputMode="numeric" placeholder={repPlaceholder}
        className="gym-set-compact-input"
        value={row.reps}
        onChange={e => onChange('reps', e.target.value)}
      />
      <RPESelect value={row.rpe} onChange={v => onChange('rpe', v)} />
      {canRemove && <button className="gym-set-remove-btn" onClick={onRemove}>×</button>}
    </div>
  )
}

// ── OVERLOAD COACH (F3) ───────────────────────────────────────────────────
// Top-level import (hoisted per ESM spec); lives here so the whole
// integration ships as one atomic edit.
import { suggestNextTarget } from '../overloadUtils.js'

// ── EXERCISE CARD ─────────────────────────────────────────────────────────

function ExerciseCard({
  ex, exIdx, inputRows, exHistory, onInputChange, onLogAll, onAddRow, onRemoveRow, isActiveCard,
  editRows, onEditStart, onEditChange, onEditRemove, onEditSave, onEditCancel,
  substituteState, onSubstituteOpen, onSubstituteQuery, onSubstitutePick, onSubstituteCancel,
  onSkip,
}) {
  const rec = getExRec(ex.name, ex.repRange, exHistory)
  // Overload Coach: null when <2 sessions of history (custom/new exercises) → no chip.
  const target = suggestNextTarget(ex.name, exHistory[ex.name], { weightUnit: getWeightUnit(), repRange: ex.repRange })
  // Tap-to-prefill: fill the next empty input row (or the first pending one) with the target.
  const applyTarget = () => {
    if (!target || !inputRows.length) return
    const emptyRi = inputRows.findIndex(r => !String(r.weight ?? '').trim() || !String(r.reps ?? '').trim())
    const ri = emptyRi >= 0 ? emptyRi : 0
    onInputChange(exIdx, ri, 'weight', String(target.weight))
    onInputChange(exIdx, ri, 'reps', String(target.reps))
  }
  const loggedCount = ex.sets.length
  const totalTarget = loggedCount + inputRows.length
  const validRows = inputRows.filter(r => parseFloat(r.weight) > 0 && parseInt(r.reps) > 0 && r.rpe)
  const isEditing = !!editRows
  const isSubstituting = !!substituteState

  if (isEditing) {
    return (
      <div className="gym-log-exercise-card">
        <div className="gym-log-ex-header">
          <div className="gym-log-ex-name">{ex.name}</div>
          <span className="gym-edit-badge">Editing</span>
        </div>
        {editRows.map((row, ri) => (
          <div key={ri} className="gym-set-row-compact">
            <span className="gym-set-row-label">Set {ri + 1}</span>
            <input type="text" inputMode="decimal" placeholder={getWeightUnit()} className="gym-set-compact-input"
              value={row.weight} onChange={e => onEditChange(ri, 'weight', e.target.value)} />
            <input type="text" inputMode="numeric" placeholder="reps" className="gym-set-compact-input"
              value={row.reps} onChange={e => onEditChange(ri, 'reps', e.target.value)} />
            <RPESelect value={row.rpe} onChange={v => onEditChange(ri, 'rpe', v)} />
            <button className="gym-set-remove-btn" onClick={() => onEditRemove(ri)}>×</button>
          </div>
        ))}
        <div className="gym-card-footer" style={{ marginTop: 12 }}>
          <button className="btn-primary" style={{ flex: 1, fontSize: '0.8125rem', padding: '8px 0' }} onClick={onEditSave}>Save</button>
          <button className="btn-secondary" style={{ fontSize: '0.8125rem', padding: '8px 14px' }} onClick={onEditCancel}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`gym-log-exercise-card${isActiveCard ? ' card-breathing' : ''}`}>
      <div className="gym-log-ex-header">
        <div className="gym-log-ex-name">{ex.name}</div>
        {totalTarget > 0 && (
          <div className={`gym-log-ex-progress${loggedCount >= totalTarget && totalTarget > 0 ? ' done' : ''}`}>
            {loggedCount}/{totalTarget}
          </div>
        )}
      </div>

      <div className="gym-log-po-rec">
        {rec.seed
          ? <span className="po-seed">No history — enter a working weight to seed the engine</span>
          : (
            <>
              {rec.e1rm ? <>e1RM <AnimatedNum value={rec.e1rm} /> · </> : ''}{rec.lastStr}
              <br />
              <span className="po-suggest">
                → Try <strong>{rec.sW} {rec.unit || 'lbs'} × {rec.sR}</strong>{' '}
                <span className={`po-tag${rec.tc ? ' ' + rec.tc : ''}`}>{rec.tag}</span>
              </span>
            </>
          )}
      </div>

      {loggedCount > 0 && (
        <div className="gym-logged-sets-wrap">
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
          <button className="gym-edit-sets-btn" onClick={onEditStart}>✏ Edit</button>
        </div>
      )}

      {inputRows.map((row, ri) => (
        <SetInputRow
          key={ri}
          setNum={loggedCount + ri + 1}
          row={row}
          onChange={(field, val) => onInputChange(exIdx, ri, field, val)}
          onRemove={() => onRemoveRow(exIdx, ri)}
          canRemove={inputRows.length > 1 || loggedCount > 0}
          repPlaceholder={rec.seed && ex.repRange ? ex.repRange : 'reps'}
        />
      ))}

      <div className="gym-card-footer">
        <button className="gym-add-set-btn" style={{ margin: 0 }} onClick={() => onAddRow(exIdx)}>+ Set</button>
        {validRows.length > 0 && (
          <button
            className="btn-primary"
            style={{ fontSize: '0.8125rem', padding: '7px 14px' }}
            onClick={() => onLogAll(exIdx, inputRows)}
          >
            ✓ Log {validRows.length > 1 ? `${validRows.length} Sets` : 'Set'}
          </button>
        )}
      </div>

      {isSubstituting ? (
        <div className="gym-sub-search">
          <input
            className="gym-ex-search"
            placeholder="Search replacement exercise..."
            autoFocus
            value={substituteState.query}
            onChange={e => onSubstituteQuery(exIdx, e.target.value)}
          />
          {substituteState.results?.map(r => (
            <button key={r.name} className="gym-ex-result-row" onClick={() => onSubstitutePick(exIdx, r)}>
              <span className="gym-ex-result-name">{r.name}</span>
              {r.primary_muscle && <span className={`gym-muscle-badge muscle-${r.primary_muscle}`}>{r.primary_muscle}</span>}
            </button>
          ))}
          <button className="btn-ghost" style={{ fontSize: '0.75rem', marginTop: 6, color: 'var(--text-tertiary)' }} onClick={onSubstituteCancel}>Cancel</button>
        </div>
      ) : (
        <div className="gym-card-extra-actions">
          <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 8px', color: 'var(--text-tertiary)' }}
            onClick={() => onSubstituteOpen(exIdx)}>⇄ Substitute</button>
          <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 8px', color: 'var(--text-tertiary)' }}
            onClick={() => onSkip(exIdx)}>↷ Skip</button>
        </div>
      )}
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

export default function LogView({ activeSession, onLogAllSets, onEditSets, onSkip, onSubstitute, onFinish, onCancel, onStartWorkout, onAddExercise }) {
  const [exHistory, setExHistory] = useState(() => storeGet('gym_exercise_history') || {})
  const [elapsed, setElapsed] = useState(0)
  const [inputs, setInputs] = useState({})
  const [editStates, setEditStates] = useState({})
  const [substituteState, setSubstituteState] = useState(null)
  const [addExState, setAddExState] = useState(null)
  const subTimerRef = useRef(null)
  const addExTimerRef = useRef(null)
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

  // Initialize input rows when session starts or exercises change
  useEffect(() => {
    if (!activeSession) { setInputs({}); setEditStates({}); setSubstituteState(null); return }
    const hist = storeGet('gym_exercise_history') || {}
    setInputs(prev => {
      const next = {}
      activeSession.exercises.forEach((ex, i) => {
        if (prev[i] !== undefined) { next[i] = prev[i]; return }
        const rec = getExRec(ex.name, ex.repRange, hist)
        const sessions = hist[ex.name]?.sessions
        const last = sessions?.length ? sessions[sessions.length - 1] : null
        const defW = rec.suggest ? String(rec.suggest.weight) : (last ? String(last.weight) : '')
        const defR = rec.suggest ? String(rec.suggest.reps) : ''
        const defRow = { weight: defW, reps: defR, rpe: null }
        const remaining = Math.max((ex.targetSets || 3) - ex.sets.length, 0)
        next[i] = remaining > 0 ? Array.from({ length: remaining }, () => ({ ...defRow })) : []
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

  const handleLogAll = useCallback((ei, rows) => {
    onLogAllSets(ei, rows)
    setInputs(prev => ({ ...prev, [ei]: [] }))
  }, [onLogAllSets])

  const handleAddRow = useCallback((ei) => {
    const ex = activeSession?.exercises[ei]
    if (!ex) return
    const hist = storeGet('gym_exercise_history') || {}
    const rec = getExRec(ex.name, ex.repRange, hist)
    const sessions = hist[ex.name]?.sessions
    const last = sessions?.length ? sessions[sessions.length - 1] : null
    const defW = rec.suggest ? String(rec.suggest.weight) : (last ? String(last.weight) : '')
    const defR = rec.suggest ? String(rec.suggest.reps) : ''
    setInputs(prev => ({ ...prev, [ei]: [...(prev[ei] || []), { weight: defW, reps: defR, rpe: null }] }))
  }, [activeSession])

  const handleRemoveRow = useCallback((ei, ri) => {
    setInputs(prev => ({ ...prev, [ei]: (prev[ei] || []).filter((_, i) => i !== ri) }))
  }, [])

  // Edit logged sets
  const handleEditStart = useCallback((ei) => {
    const ex = activeSession?.exercises[ei]
    if (!ex) return
    setEditStates(prev => ({
      ...prev,
      [ei]: ex.sets.map(s => ({ weight: String(s.weight), reps: String(s.reps), rpe: s.rpe }))
    }))
  }, [activeSession])

  const handleEditChange = useCallback((ei, ri, field, val) => {
    setEditStates(prev => {
      const rows = [...(prev[ei] || [])]
      rows[ri] = { ...(rows[ri] || {}), [field]: val }
      return { ...prev, [ei]: rows }
    })
  }, [])

  const handleEditRemove = useCallback((ei, ri) => {
    setEditStates(prev => ({ ...prev, [ei]: (prev[ei] || []).filter((_, i) => i !== ri) }))
  }, [])

  const handleEditSave = useCallback((ei) => {
    onEditSets(ei, editStates[ei] || [])
    setEditStates(prev => { const next = { ...prev }; delete next[ei]; return next })
  }, [editStates, onEditSets])

  const handleEditCancel = useCallback((ei) => {
    setEditStates(prev => { const next = { ...prev }; delete next[ei]; return next })
  }, [])

  // Substitute
  const handleSubstituteOpen = useCallback((exIdx) => {
    setSubstituteState({ exIdx, query: '', results: [] })
  }, [])

  const handleSubstituteQuery = useCallback((exIdx, query) => {
    setSubstituteState(prev => prev ? { ...prev, query } : null)
    clearTimeout(subTimerRef.current)
    if (query.trim().length >= 2) {
      subTimerRef.current = setTimeout(async () => {
        const results = await searchExercises(query)
        setSubstituteState(prev => prev?.exIdx === exIdx ? { ...prev, results } : prev)
      }, 300)
    } else {
      setSubstituteState(prev => prev?.exIdx === exIdx ? { ...prev, results: [] } : prev)
    }
  }, [])

  const handleSubstitutePick = useCallback((exIdx, exercise) => {
    onSubstitute(exIdx, exercise)
    setSubstituteState(null)
    setEditStates(prev => { const next = { ...prev }; delete next[exIdx]; return next })
    // Clear inputs so useEffect re-initializes with new exercise history
    setInputs(prev => { const next = { ...prev }; delete next[exIdx]; return next })
  }, [onSubstitute])

  const handleSubstituteCancel = useCallback(() => setSubstituteState(null), [])

  // Skip — shift index keys for exercises after the removed one
  const handleSkip = useCallback((ei) => {
    setInputs(prev => {
      const next = {}
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k)
        if (ki < ei) next[ki] = v
        else if (ki > ei) next[ki - 1] = v
      })
      return next
    })
    setEditStates(prev => {
      const next = {}
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k)
        if (ki < ei) next[ki] = v
        else if (ki > ei) next[ki - 1] = v
      })
      return next
    })
    onSkip(ei)
  }, [onSkip])

  const handleAddExOpen = useCallback(() => setAddExState({ query: '', results: [] }), [])

  const handleAddExQuery = useCallback((query) => {
    setAddExState(prev => prev ? { ...prev, query } : null)
    clearTimeout(addExTimerRef.current)
    if (query.trim().length >= 2) {
      addExTimerRef.current = setTimeout(async () => {
        const results = await searchExercises(query)
        setAddExState(prev => prev ? { ...prev, results } : null)
      }, 300)
    } else {
      setAddExState(prev => prev ? { ...prev, results: [] } : null)
    }
  }, [])

  const handleAddExPick = useCallback((exercise) => {
    onAddExercise(exercise)
    setAddExState(null)
  }, [onAddExercise])

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn-ghost"
            style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', padding: '7px 12px' }}
            onClick={() => {
              const hasLogged = activeSession.exercises.some(ex => ex.sets.length > 0)
              const msg = hasLogged ? 'Cancel workout? Your logged sets will be lost.' : 'Cancel workout?'
              if (confirm(msg)) onCancel()
            }}
          >Cancel</button>
          <button className="btn-primary" style={{ background: 'linear-gradient(135deg,#6BE3A4 0%,#3dba7e 100%)', color: '#050506' }} onClick={onFinish}>✓ Finish</button>
        </div>
      </div>
      {activeSession.exercises.map((ex, ei) => {
        const isActiveCard = ei === activeSession.exercises.findIndex(
          (e) => e.sets.length < (e.targetSets || 1)
        )
        return (
          <ExerciseCard
            key={ei}
            ex={ex}
            exIdx={ei}
            inputRows={inputs[ei] || []}
            exHistory={exHistory}
            onInputChange={handleInputChange}
            onLogAll={handleLogAll}
            onAddRow={handleAddRow}
            onRemoveRow={handleRemoveRow}
            isActiveCard={isActiveCard}
            editRows={editStates[ei] || null}
            onEditStart={() => handleEditStart(ei)}
            onEditChange={(ri, field, val) => handleEditChange(ei, ri, field, val)}
            onEditRemove={(ri) => handleEditRemove(ei, ri)}
            onEditSave={() => handleEditSave(ei)}
            onEditCancel={() => handleEditCancel(ei)}
            substituteState={substituteState?.exIdx === ei ? substituteState : null}
            onSubstituteOpen={handleSubstituteOpen}
            onSubstituteQuery={handleSubstituteQuery}
            onSubstitutePick={handleSubstitutePick}
            onSubstituteCancel={handleSubstituteCancel}
            onSkip={handleSkip}
          />
        )
      })}

      {addExState ? (
        <div className="gym-log-exercise-card">
          <div className="gym-log-ex-header">
            <div className="gym-log-ex-name">Add Exercise</div>
          </div>
          <input
            className="gym-ex-search"
            placeholder="Search exercises..."
            autoFocus
            value={addExState.query}
            onChange={e => handleAddExQuery(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          {addExState.results?.map(r => (
            <button key={r.name} className="gym-ex-result-row" onClick={() => handleAddExPick(r)}>
              <span className="gym-ex-result-name">{r.name}</span>
              {r.primary_muscle && <span className={`gym-muscle-badge muscle-${r.primary_muscle}`}>{r.primary_muscle}</span>}
            </button>
          ))}
          <button className="btn-ghost" style={{ fontSize: '0.75rem', marginTop: 8, color: 'var(--text-tertiary)' }} onClick={() => setAddExState(null)}>Cancel</button>
        </div>
      ) : (
        <button
          className="btn-ghost"
          style={{ width: '100%', marginTop: 4, marginBottom: 12, fontSize: '0.8125rem', color: 'var(--text-tertiary)', padding: '10px 0' }}
          onClick={handleAddExOpen}
        >+ Add Exercise</button>
      )}
    </div>
  )
}
