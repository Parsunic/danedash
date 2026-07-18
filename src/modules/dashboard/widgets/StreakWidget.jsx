import { useState, useEffect, useCallback } from 'react'
import { storeGet } from '../../../lib/storage.js'
import { getActiveDateString } from '../../../lib/dateHelpers.js'

// Streak widget — the goal-completion streak + the last 7 days of progress.
// goal_streak_v1 shape (written by Todo.computeStreak): { count, lastProcessedDate }.
// We only READ it here (never storeSet). Per-day progress comes from the
// goals:YYYY-MM-DD lists. Listens 'goals-changed', 'sync-applied'.

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const HERO = { fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 40, lineHeight: 1, color: 'var(--text-primary)' }
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Last 7 days ending on the active date (oldest first).
function loadLast7() {
  const [y, m, d] = getActiveDateString().split('-').map(Number)
  const out = []
  for (let i = 6; i >= 0; i--) {
    const date = new Date(y, m - 1, d - i)
    const ds = localDateStr(date)
    const goals = storeGet('goals:' + ds) || []
    const total = goals.length
    const done = goals.filter(g => g.done).length
    out.push({ ds, initial: DAY_INITIALS[date.getDay()], done, total, ratio: total ? done / total : 0 })
  }
  return out
}

function loadStreak() {
  return (storeGet('goal_streak_v1') || { count: 0 }).count || 0
}

export default function StreakWidget({ size, bp }) {
  const [streak, setStreak] = useState(loadStreak)
  const [days, setDays] = useState(loadLast7)

  const refresh = useCallback(() => {
    setStreak(loadStreak())
    setDays(loadLast7())
  }, [])
  useEffect(() => {
    window.addEventListener('goals-changed', refresh)
    window.addEventListener('sync-applied', refresh)
    return () => {
      window.removeEventListener('goals-changed', refresh)
      window.removeEventListener('sync-applied', refresh)
    }
  }, [refresh])

  const hero = (
    <>
      <div className="dash-widget-label">Streak</div>
      <div style={{ ...HERO, marginTop: 4 }}>{streak}</div>
      <div className="dash-widget-label" style={{ marginTop: 3 }}>day streak</div>
    </>
  )

  // ── S: streak number + micro-copy ──
  if (size === 'S') {
    return (
      <div style={ROOT_STYLE}>
        {hero}
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>
          {streak === 0 ? 'Start the chain today.' : 'Keep the chain.'}
        </div>
      </div>
    )
  }

  // ── M: + last-7-days mini bars ──
  const isToday = (i) => i === days.length - 1
  return (
    <div style={ROOT_STYLE}>
      <div className="dash-widget-header" style={{ marginBottom: 6 }}>
        <span className="dash-widget-label">Streak</span>
        <span className="dash-next-time">{streak} day{streak === 1 ? '' : 's'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={HERO}>{streak}</span>
        <span className="dash-widget-label">day streak</span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginTop: 'auto', height: 46 }}>
        {days.map((d, i) => {
          const full = d.total > 0 && d.done === d.total
          const h = d.total === 0 ? 3 : Math.max(4, Math.round(d.ratio * 34))
          return (
            <div key={d.ds} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0 }}>
              <div style={{ height: 34, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                <div
                  title={`${d.done}/${d.total} done`}
                  style={{
                    width: '100%', height: h, borderRadius: 3,
                    background: full ? 'var(--accent)' : d.total ? 'rgba(232,160,32,0.45)' : 'rgba(255,255,255,0.06)',
                    boxShadow: (full && isToday(i)) ? '0 0 8px rgba(232,160,32,0.6)' : 'none',
                  }}
                />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: isToday(i) ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                {d.initial}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
