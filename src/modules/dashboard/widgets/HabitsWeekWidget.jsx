import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { storeGet } from '../../../lib/storage.js'
import { getActiveDateString, getActiveWeekKey } from '../../../lib/dateHelpers.js'

// Habits Week widget — today's completion + the week's grid.
// Completion logic mirrors HabitsSection/PulseWidget EXACTLY, including the
// auto_source==='gym' rule (a fitness habit auto-completes on days with a
// gym_workout_logs entry). DOMAIN_COLORS is the exact mapping from
// GoalsPulseCard/PulseWidget. Listens 'goals-changed', 'gym-changed', 'sync-applied'.

const DOMAIN_COLORS = {
  fitness:   '#E8A020',
  sleep:     '#7048E8',
  mental:    '#6BE3A4',
  learning:  '#1971C2',
  academics: '#F2C063',
  other:     'rgba(255,255,255,0.4)',
}
const domainColor = (d) => DOMAIN_COLORS[d] ?? 'rgba(255,255,255,0.4)'

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const ONE_LINE = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Mon-based week containing the active date (mirrors HabitsSection.getWeekDays).
function getWeekDays(activeDateStr) {
  const [y, m, d] = activeDateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay() || 7
  const out = []
  for (let i = 0; i < 7; i++) out.push(localDateStr(new Date(y, m - 1, d - (dow - 1) + i)))
  return out
}

function loadData() {
  const habits = storeGet('habits') || []
  const log = storeGet('habits_log:' + getActiveWeekKey()) || {}
  const gymDates = new Set((storeGet('gym_workout_logs') || []).map(l => l.date))
  return { habits, log, gymDates }
}

function isCompleted(habit, day, log, gymDates) {
  if (habit.auto_source === 'gym') return gymDates.has(day)
  return (log[habit.id] || []).includes(day)
}

const HERO = { fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--text-primary)' }

export default function HabitsWeekWidget({ size, bp }) {
  const [{ habits, log, gymDates }, setData] = useState(loadData)

  const refresh = useCallback(() => setData(loadData()), [])
  useEffect(() => {
    window.addEventListener('goals-changed', refresh)
    window.addEventListener('gym-changed', refresh)
    window.addEventListener('sync-applied', refresh)
    return () => {
      window.removeEventListener('goals-changed', refresh)
      window.removeEventListener('gym-changed', refresh)
      window.removeEventListener('sync-applied', refresh)
    }
  }, [refresh])

  const today = getActiveDateString()
  const weekDays = getWeekDays(today)

  // ── Empty: no habits ──
  if (habits.length === 0) {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-label">Habits</div>
        <div style={{ ...HERO, fontSize: 19, lineHeight: 1.15, marginTop: 8 }}>No habits set</div>
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>Non-negotiables first.</div>
        <Link to="/goals" className="dash-widget-link" style={{ marginTop: 6 }}>Add habits →</Link>
      </div>
    )
  }

  const doneToday = habits.filter(h => isCompleted(h, today, log, gymDates))
  const firstIncomplete = habits.find(h => !isCompleted(h, today, log, gymDates)) || null

  // ── S: today's fraction + next habit ──
  if (size === 'S') {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-label">Habits</div>
        <div style={{ ...HERO, fontSize: 34, lineHeight: 1, marginTop: 4 }}>
          {doneToday.length}<span style={{ fontSize: 20, opacity: 0.5 }}>/{habits.length}</span>
        </div>
        <div className="dash-widget-label" style={{ marginTop: 3 }}>habits today</div>
        <div className="dash-task-text" style={{ ...ONE_LINE, marginTop: 'auto', fontSize: 12 }}>
          {firstIncomplete ? `Next: ${firstIncomplete.name}` : 'All done today.'}
        </div>
      </div>
    )
  }

  // ── M: today's dot row + names ──
  if (size === 'M') {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-header" style={{ marginBottom: 8 }}>
          <span className="dash-widget-label">Habits Today</span>
          <span className="dash-next-time">{doneToday.length}/{habits.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {habits.map(h => {
            const done = isCompleted(h, today, log, gymDates)
            return (
              <span
                key={h.id}
                title={h.name}
                style={{
                  width: 13, height: 13, borderRadius: '50%',
                  background: done ? domainColor(h.domain) : 'transparent',
                  border: done ? 'none' : '1.5px solid rgba(255,255,255,0.18)',
                  flexShrink: 0,
                }}
              />
            )
          })}
        </div>
        <div style={{ marginTop: 'auto', minWidth: 0 }}>
          {habits.slice(0, 3).map(h => {
            const done = isCompleted(h, today, log, gymDates)
            return (
              <div key={h.id} className="dash-task-text" style={{ ...ONE_LINE, fontSize: 12, lineHeight: 1.55, opacity: done ? 0.5 : 0.9 }}>
                <span style={{ color: domainColor(h.domain) }}>{done ? '● ' : '○ '}</span>{h.name}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── L: 7-day × habits grid (cap 6 rows) + weekly % ──
  const rowsShown = habits.slice(0, 6)
  let doneCells = 0
  habits.forEach(h => weekDays.forEach(day => { if (isCompleted(h, day, log, gymDates)) doneCells++ }))
  const weeklyPct = habits.length ? Math.round((doneCells / (habits.length * 7)) * 100) : 0
  const gridCols = `minmax(0,1fr) repeat(7, 15px)`

  return (
    <div style={ROOT_STYLE}>
      <div className="dash-widget-header">
        <span className="dash-widget-label">This Week</span>
        <Link to="/goals" className="dash-widget-link">Goals →</Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '4px 3px', alignItems: 'center' }}>
        <div />
        {DAY_LETTERS.map((l, i) => (
          <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textAlign: 'center', color: 'var(--text-tertiary)' }}>{l}</div>
        ))}
        {rowsShown.map(h => (
          <div key={h.id} style={{ display: 'contents' }}>
            <span className="dash-task-text" style={{ ...ONE_LINE, fontSize: 12 }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: domainColor(h.domain), marginRight: 6, verticalAlign: 'middle' }} />
              {h.name}
            </span>
            {weekDays.map(day => {
              const done = isCompleted(h, day, log, gymDates)
              return (
                <span
                  key={day}
                  style={{
                    justifySelf: 'center',
                    width: 12, height: 12, borderRadius: 3,
                    background: done ? domainColor(h.domain) : 'rgba(255,255,255,0.05)',
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 'auto', paddingTop: 8 }}>
        <span className="dash-next-time">{weeklyPct}% this week</span>
        <span className="dash-widget-empty" style={{ ...ONE_LINE, padding: 0 }}>
          {weeklyPct >= 80 ? 'Dialed in.' : weeklyPct >= 50 ? 'Holding the line.' : 'Chip away at it.'}
        </span>
      </div>
    </div>
  )
}
