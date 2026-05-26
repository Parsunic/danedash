import { useState, useEffect, useCallback, useRef } from 'react'
import { storeGet } from '../../../lib/storage.js'
import { getActiveDateString } from '../../../lib/dateHelpers.js'
import { getExRec, fmtElapsed } from '../gymUtils.js'

function RPEStrip({ selected, onSelect, highlightFirst }) {
  return (
    <div className="rpe-strip">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(r => (
        <button
          key={r}
          className={`rpe-btn${selected === r ? ' selected' : ''}`}
          style={highlightFirst && r === 1 ? { outline: '2px solid var(--danger)' } : {}}
          onClick={() => onSelect(r)}
        >{r}</button>
      ))}
    </div>
  )
}

function ExerciseCard({ ex, exIdx, sets, input, exHistory, onInputChange, onLogSet }) {
  const rec = getExRec(ex.name, ex.repRange, exHistory)
  const [rpeHighlight, setRpeHighlight] = useState(false)

  const handleLog = useCallback(() => {
    const w = parseFloat(input.weight), r = parseInt(input.reps)
    if (!w || w <= 0) return
    if (!r || r <= 0) return
    if (!input.rpe) {
      setRpeHighlight(true)
      setTimeout(() => setRpeHighlight(false), 1400)
      return
    }
    onLogSet(exIdx, w, r, input.rpe)
  }, [input, exIdx, onLogSet])

  const setNum = sets.length + 1

  return (
    <div className="gym-log-exercise-card">
      <div className="gym-log-ex-name">{ex.name}</div>
      <div className="gym-log-po-rec">
        {rec.seed
          ? <span className="po-seed">No history — enter a working weight to seed the engine</span>
          : <>
              {rec.e1rmStr && <>{rec.e1rmStr}</>}
              {rec.lastStr}
              <br />
              <span className="po-suggest">
                → Try <strong>{rec.sW} lbs × {rec.sR}</strong>{' '}
                <span className={`po-tag${rec.tc ? ' ' + rec.tc : ''}`}>{rec.tag}</span>
              </span>
            </>
        }
      </div>
      {sets.length > 0 && (
        <table className="gym-sets-table">
          <thead>
            <tr>
              <th>Set</th><th>Weight</th><th>Reps</th><th>RPE</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s, si) => (
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
      <div className="gym-new-set-row">
        <div className="gym-new-set-field">
          <div className="gym-new-set-label">Set {setNum} · lbs</div>
          <input
            type="number"
            className="gym-new-set-input"
            placeholder="135"
            inputMode="decimal"
            value={input.weight}
            onChange={e => onInputChange(exIdx, 'weight', e.target.value)}
          />
        </div>
        <div className="gym-new-set-field">
          <div className="gym-new-set-label">Reps</div>
          <input
            type="number"
            className="gym-new-set-input"
            placeholder="8"
            inputMode="numeric"
            value={input.reps}
            onChange={e => onInputChange(exIdx, 'reps', e.target.value)}
          />
        </div>
        <div className="gym-new-set-field">
          <div className="gym-new-set-label">RPE</div>
          <RPEStrip
            selected={input.rpe}
            onSelect={r => onInputChange(exIdx, 'rpe', r)}
            highlightFirst={rpeHighlight}
          />
        </div>
        <button className="btn-log-set" onClick={handleLog}>✓ Log</button>
      </div>
    </div>
  )
}

function LogIdle({ onStartWorkout }) {
  const todayStr = getActiveDateString()
  const pw = (storeGet('gym_planned') || []).find(p => p.date === todayStr)
  const templates = storeGet('gym_templates') || []
  const [selTpl, setSelTpl] = useState('')

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
        <button className="btn-gym-primary" style={{ width: '100%', padding: 14, fontSize: 15 }} onClick={() => onStartWorkout(pw.exercises, pw.id, pw.name)}>▶ Start Workout</button>
      </div>
    )
  }

  if (pw && pw.status === 'completed') {
    return (
      <div className="gym-log-idle">
        <div className="gym-log-idle-title">✓ {pw.name}</div>
        <div className="gym-log-idle-sub">Today's workout already logged.</div>
        <button className="btn-gym-secondary" style={{ marginTop: 12 }} onClick={() => onStartWorkout(pw.exercises, null, pw.name + ' (extra)')}>Log Another Session</button>
      </div>
    )
  }

  return (
    <div className="gym-log-idle">
      <div className="gym-log-idle-title">No workout scheduled today</div>
      <div className="gym-log-idle-sub">Check the Planner or pick a template below.</div>
      {templates.length > 0 && <>
        <select className="gym-input" style={{ margin: '12px 0' }} value={selTpl} onChange={e => setSelTpl(e.target.value)}>
          <option value="">— Pick a template —</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button
          className="btn-gym-primary"
          style={{ width: '100%', padding: 14, fontSize: 15 }}
          onClick={() => {
            const t = templates.find(x => x.id === selTpl)
            if (t) onStartWorkout(t.exercises, null, t.name)
          }}
        >▶ Start Workout</button>
      </>}
    </div>
  )
}

export default function LogView({ activeSession, onLogSet, onFinish, onStartWorkout }) {
  const [exHistory, setExHistory] = useState(() => storeGet('gym_exercise_history') || {})
  const [elapsed, setElapsed] = useState(0)
  const [inputs, setInputs] = useState({})
  const timerRef = useRef(null)

  useEffect(() => {
    const reload = () => setExHistory(storeGet('gym_exercise_history') || {})
    window.addEventListener('gym-changed', reload)
    return () => window.removeEventListener('gym-changed', reload)
  }, [])

  // Start/stop session timer
  useEffect(() => {
    clearInterval(timerRef.current)
    if (activeSession) {
      setElapsed(Date.now() - activeSession.startedAt)
      timerRef.current = setInterval(() => setElapsed(Date.now() - activeSession.startedAt), 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [activeSession])

  // Initialize inputs for new exercises when session starts or exercises are added
  useEffect(() => {
    if (!activeSession) { setInputs({}); return }
    setInputs(prev => {
      const next = { ...prev }
      activeSession.exercises.forEach((ex, i) => {
        if (!next[i]) {
          const rec = getExRec(ex.name, ex.repRange, storeGet('gym_exercise_history') || {})
          next[i] = { weight: rec.suggest ? String(rec.suggest.weight) : '', reps: rec.suggest ? String(rec.suggest.reps) : '', rpe: null }
        }
      })
      return next
    })
  }, [activeSession])

  const handleInputChange = useCallback((ei, field, val) => {
    setInputs(prev => ({ ...prev, [ei]: { ...(prev[ei] || {}), [field]: val } }))
  }, [])

  const handleLogSet = useCallback((ei, weight, reps, rpe) => {
    onLogSet(ei, weight, reps, rpe)
    setInputs(prev => ({ ...prev, [ei]: { weight: String(weight), reps: '', rpe: null } }))
  }, [onLogSet])

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
        <button className="btn-finish-workout" onClick={onFinish}>✓ Finish</button>
      </div>
      {activeSession.exercises.map((ex, ei) => (
        <ExerciseCard
          key={ei}
          ex={ex}
          exIdx={ei}
          sets={ex.sets}
          input={inputs[ei] || { weight: '', reps: '', rpe: null }}
          exHistory={exHistory}
          onInputChange={handleInputChange}
          onLogSet={handleLogSet}
        />
      ))}
    </div>
  )
}
