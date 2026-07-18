import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { storeGet } from '../../../lib/storage.js'
import { getActiveDateString, getTomorrowDateString } from '../../../lib/dateHelpers.js'

// Gym Next widget — next planned workout + this-week training count.
// Data: gym_planned (next non-completed entry, date >= today, by date) and
// gym_workout_logs (this-week completed count). Self-contained; listens for
// 'gym-changed' + 'sync-applied' (the same events LogView/PlannerView emit).
// S: name + day tag. M: + exercise count + first few names + Start link.
// L: + full list with sets×repRange (mono) + this-week completed count.

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const ONE_LINE = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const TWO_LINE = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Mon-based week containing the active date (mirrors HabitsSection.getWeekDays).
function weekDates(activeDateStr) {
  const [y, m, d] = activeDateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay() || 7
  const out = []
  for (let i = 0; i < 7; i++) out.push(localDateStr(new Date(y, m - 1, d - (dow - 1) + i)))
  return out
}

function dayLabel(dateStr) {
  if (dateStr === getActiveDateString()) return 'Today'
  if (dateStr === getTomorrowDateString()) return 'Tomorrow'
  const [y, m, d] = dateStr.split('-').map(Number)
  return WD[new Date(y, m - 1, d).getDay()]
}

const NAME_HERO = { fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--text-primary)' }

export default function GymNextWidget({ size, bp }) {
  const [next, setNext] = useState(null)
  const [weekCount, setWeekCount] = useState(0)

  const load = useCallback(() => {
    const today = getActiveDateString()
    const upcoming = (storeGet('gym_planned') || [])
      .filter(p => p.status !== 'completed' && p.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
    setNext(upcoming[0] || null)
    const wd = new Set(weekDates(today))
    const logs = storeGet('gym_workout_logs') || []
    setWeekCount(logs.filter(l => wd.has(l.date)).length)
  }, [])

  useEffect(() => {
    load()
    window.addEventListener('gym-changed', load)
    window.addEventListener('sync-applied', load)
    return () => {
      window.removeEventListener('gym-changed', load)
      window.removeEventListener('sync-applied', load)
    }
  }, [load])

  // ── Empty: nothing planned ──
  if (!next) {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-label">Next Workout</div>
        <div style={{ ...NAME_HERO, fontSize: 19, lineHeight: 1.15, marginTop: 8 }}>
          No workout planned
        </div>
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>Rest is part of the plan.</div>
        <Link to="/gym" className="dash-widget-link" style={{ marginTop: 6 }}>Plan one →</Link>
      </div>
    )
  }

  const exs = next.exercises || []
  const label = dayLabel(next.date)

  // ── S: name + day tag ──
  if (size === 'S') {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-label">Next Workout</div>
        <div style={{ ...NAME_HERO, fontSize: 22, lineHeight: 1.12, marginTop: 6, ...TWO_LINE }}>
          {next.name}
        </div>
        <div className="dash-next-label" style={{ marginTop: 'auto' }}>{label}</div>
        <div className="dash-next-time">{exs.length} exercise{exs.length === 1 ? '' : 's'}</div>
      </div>
    )
  }

  // ── M: + first exercise names + Start link ──
  if (size === 'M') {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-header" style={{ marginBottom: 6 }}>
          <span className="dash-widget-label">Next Workout</span>
          <Link to="/gym" className="dash-widget-link">Start →</Link>
        </div>
        <div style={{ ...NAME_HERO, fontSize: 20, lineHeight: 1.1, ...ONE_LINE }}>{next.name}</div>
        <div className="dash-next-time" style={{ marginTop: 3 }}>
          <span className="dash-next-label" style={{ display: 'inline' }}>{label}</span> · {exs.length} exercise{exs.length === 1 ? '' : 's'}
        </div>
        <div style={{ marginTop: 'auto', minWidth: 0 }}>
          {exs.slice(0, 3).map((ex, i) => (
            <div key={i} className="dash-task-text" style={{ ...ONE_LINE, fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
              {ex.name}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── L: full list with sets×repRange + this-week count ──
  const shown = exs.slice(0, 6)
  const overflow = exs.length - shown.length
  return (
    <div style={ROOT_STYLE}>
      <div className="dash-widget-header">
        <span className="dash-widget-label">Next Workout</span>
        <Link to="/gym" className="dash-widget-link">Gym →</Link>
      </div>
      <div style={{ ...NAME_HERO, fontSize: 22, lineHeight: 1.1, ...ONE_LINE }}>{next.name}</div>
      <div className="dash-next-time" style={{ marginTop: 3, marginBottom: 8 }}>
        <span className="dash-next-label" style={{ display: 'inline' }}>{label}</span> · {exs.length} exercise{exs.length === 1 ? '' : 's'}
      </div>
      <div style={{ minWidth: 0, overflow: 'hidden' }}>
        {shown.map((ex, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0', minWidth: 0 }}>
            <span className="dash-task-text" style={{ ...ONE_LINE, flex: 1, fontSize: 13 }}>{ex.name}</span>
            <span className="dash-next-time" style={{ flexShrink: 0 }}>{ex.sets}×{ex.repRange}</span>
          </div>
        ))}
        {overflow > 0 && (
          <div className="dash-widget-empty" style={{ padding: '2px 0 0' }}>+{overflow} more</div>
        )}
      </div>
      <div className="dash-next-time" style={{ marginTop: 'auto', paddingTop: 8 }}>
        {weekCount} workout{weekCount === 1 ? '' : 's'} done this week
      </div>
    </div>
  )
}
