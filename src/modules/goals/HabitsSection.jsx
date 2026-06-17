import { Fragment, useState } from 'react'
import { storeGet, storeSet } from '../../lib/storage.js'
import { getActiveDateString, getActiveWeekKey } from '../../lib/dateHelpers.js'

const DOMAINS = [
  { id: 'fitness',   label: 'Fitness',   color: '#E8A020' },
  { id: 'sleep',     label: 'Sleep',     color: '#7048E8' },
  { id: 'mental',    label: 'Mental',    color: '#6BE3A4' },
  { id: 'learning',  label: 'Learning',  color: '#1971C2' },
  { id: 'academics', label: 'Academics', color: '#F2C063' },
  { id: 'other',     label: 'Other',     color: 'rgba(255,255,255,0.4)' },
]

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function domainColor(domain) {
  return DOMAINS.find(d => d.id === domain)?.color ?? 'rgba(255,255,255,0.4)'
}

function localDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getWeekDays(activeDateStr) {
  const [y, m, d] = activeDateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay() || 7
  const days = []
  for (let i = 0; i < 7; i++) {
    days.push(localDateStr(new Date(y, m - 1, d - (dow - 1) + i)))
  }
  return days
}

export default function HabitsSection() {
  const activeDate = getActiveDateString()
  const weekKey = `habits_log:${getActiveWeekKey()}`
  const weekDays = getWeekDays(activeDate)

  const [habits, setHabits] = useState(() => storeGet('habits') || [])
  const [log, setLog] = useState(() => storeGet(weekKey) || {})

  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDomain, setFormDomain] = useState('fitness')
  const [formTarget, setFormTarget] = useState(3)
  const [formAutoGym, setFormAutoGym] = useState(false)

  const gymDates = new Set((storeGet('gym_workout_logs') || []).map(l => l.date))

  function isCompleted(habit, day) {
    if (habit.auto_source === 'gym') return gymDates.has(day)
    return (log[habit.id] || []).includes(day)
  }

  function toggleDay(habit, day) {
    if (habit.auto_source === 'gym') return
    const current = log[habit.id] || []
    const next = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day]
    const newLog = { ...log, [habit.id]: next }
    setLog(newLog)
    storeSet(weekKey, newLog)
  }

  function countCompleted(habit) {
    return weekDays.filter(day => isCompleted(habit, day)).length
  }

  function saveHabit() {
    if (!formName.trim() || habits.length >= 7) return
    const newHabit = {
      id: crypto.randomUUID(),
      name: formName.trim(),
      domain: formDomain,
      target_days_per_week: formTarget,
      auto_source: (formDomain === 'fitness' && formAutoGym) ? 'gym' : null,
    }
    const next = [...habits, newHabit]
    setHabits(next)
    storeSet('habits', next)
    setShowForm(false)
    setFormName('')
    setFormDomain('fitness')
    setFormTarget(3)
    setFormAutoGym(false)
  }

  function removeHabit(id) {
    const next = habits.filter(h => h.id !== id)
    setHabits(next)
    storeSet('habits', next)
    const newLog = { ...log }
    delete newLog[id]
    setLog(newLog)
    storeSet(weekKey, newLog)
  }

  const atLimit = habits.length >= 7
  const nearLimit = habits.length >= 5

  return (
    <>
      <div className="goals-section-label">Habits</div>
      <div className="habits-micro-copy">Non-negotiables first. Everything else is optional.</div>
      <div className="habits-card">
        {habits.length > 0 && (
          <div className="habits-grid">
            <div />
            {DAY_LETTERS.map((l, i) => (
              <div key={i} className="habits-day-header">{l}</div>
            ))}
            <div />

            {habits.map(habit => (
              <Fragment key={habit.id}>
                <div className="habits-row-name">
                  <span className="habit-dot" style={{ background: domainColor(habit.domain) }} />
                  <span className="habit-name-text">{habit.name}</span>
                  <button
                    className="habit-remove-btn"
                    onClick={() => removeHabit(habit.id)}
                    title="Remove habit"
                  >×</button>
                </div>
                {weekDays.map(day => {
                  const done = isCompleted(habit, day)
                  const isAuto = habit.auto_source === 'gym'
                  return (
                    <button
                      key={day}
                      className={`habit-cell${done ? ' habit-cell--filled' : ''}${isAuto ? ' habit-cell--auto' : ''}`}
                      onClick={() => toggleDay(habit, day)}
                      aria-label={`${habit.name} ${day} ${done ? 'completed' : 'not completed'}`}
                    />
                  )
                })}
                <div className="habit-score">
                  {countCompleted(habit)}/{habit.target_days_per_week}
                </div>
              </Fragment>
            ))}
          </div>
        )}

        {!showForm && (
          <button className="btn-ghost habits-add-btn" onClick={() => setShowForm(true)}>
            + Add habit
          </button>
        )}

        {showForm && (
          <div className="habits-add-form">
            {nearLimit && !atLimit && (
              <div className="habits-warning">
                You're tracking {habits.length} habits — research suggests 3–5 is optimal for consistency.
              </div>
            )}
            {atLimit && (
              <div className="habits-warning">Max 7 habits — remove one to add another.</div>
            )}
            <input
              className="habits-form-input"
              placeholder="Habit name"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveHabit() }}
              autoFocus
            />
            <div className="habits-domain-picker">
              {DOMAINS.map(d => (
                <button
                  key={d.id}
                  className={`habits-domain-btn${formDomain === d.id ? ' habits-domain-btn--active' : ''}`}
                  onClick={() => {
                    setFormDomain(d.id)
                    if (d.id !== 'fitness') setFormAutoGym(false)
                  }}
                >
                  <span className="habit-dot" style={{ background: d.color }} />
                  <span>{d.label}</span>
                </button>
              ))}
            </div>
            <div className="habits-form-row">
              <span className="habits-form-label">Days per week</span>
              <div className="habits-days-picker">
                {[1, 2, 3, 4, 5, 6, 7].map(n => (
                  <button
                    key={n}
                    className={`habits-day-num${formTarget === n ? ' habits-day-num--active' : ''}`}
                    onClick={() => setFormTarget(n)}
                  >{n}</button>
                ))}
              </div>
            </div>
            {formDomain === 'fitness' && (
              <div className="habits-form-row">
                <span className="habits-form-label">Auto-track from gym</span>
                <button
                  className={`habits-toggle${formAutoGym ? ' habits-toggle--on' : ''}`}
                  onClick={() => setFormAutoGym(v => !v)}
                >
                  {formAutoGym ? 'On' : 'Off'}
                </button>
              </div>
            )}
            <div className="habits-form-actions">
              <button className="btn-ghost" onClick={() => { setShowForm(false); setFormName('') }}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={saveHabit}
                disabled={!formName.trim() || atLimit}
              >
                Save habit
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
