import { useState, useEffect, useCallback } from 'react'
import { storeGet, storeListKeys } from '../../lib/storage.js'
import { getActiveDateString } from '../../lib/dateHelpers.js'

// ── Habit Analytics (area 'goals') ──
// Self-contained: reads `habits`, ALL `habits_log:*` weekly logs, and
// `gym_workout_logs` (for auto_source==='gym' habits), re-reading on
// goals-changed / gym-changed / sync-applied. Renders per-habit streak +
// 4-week adherence, a GitHub-style day heatmap, and a best-streak hero.
//
// Completion logic mirrors HabitsSection/HabitsWeekWidget EXACTLY:
//   - auto_source==='gym'  → done on any day with a gym_workout_logs entry
//   - otherwise            → done if the day string is in habits_log[<week>][habit.id]
// The weekly log VALUES are absolute YYYY-MM-DD date strings (not day-of-week
// flags), so day-level completion is just the union of every weekly log's
// per-habit date arrays — no week-to-date remapping needed.
//
// Chromeless like its sibling Goals cards: renders its own section label,
// voice micro-copy and a `.habitstats-card` glass surface inside `.dc-goals-cell`
// so the four Goals cards read as one congruent stack.

const DOMAIN_COLORS = {
  fitness:   '#E8A020',
  sleep:     '#7048E8',
  mental:    '#6BE3A4',
  learning:  '#1971C2',
  academics: '#F2C063',
  other:     'rgba(255,255,255,0.4)',
}
const domainColor = (d) => DOMAIN_COLORS[d] ?? 'rgba(255,255,255,0.4)'

// Heatmap buckets: 0 → faint neutral; then amber at increasing alpha; 1 → full.
const HEAT_NEUTRAL = 'rgba(255,255,255,0.05)'
const HEAT_SCALE = ['rgba(232,160,32,0.25)', 'rgba(232,160,32,0.5)', 'rgba(232,160,32,0.75)', '#E8A020']
const LEGEND_SWATCHES = [HEAT_NEUTRAL, ...HEAT_SCALE]

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return localDateStr(new Date(y, m - 1, d + n))
}
// Monday of the ISO-style week containing dateStr (matches HabitsSection's Mon-based week).
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() || 7 // Mon=1 … Sun=7
  return addDays(dateStr, -(dow - 1))
}

// Weeks of heatmap history to draw per card size. Chosen so the widest week
// count still fits the narrowest instance of that size without scrolling.
function weekCount(size, bp) {
  if (size === 'XL') return bp === 'desktop' ? 18 : 15
  return 11 // L
}

function loadData() {
  const habits = storeGet('habits') || []
  // Union every weekly log into a per-habit set of completed date strings.
  const doneByHabit = {}
  for (const key of storeListKeys('habits_log:')) {
    const week = storeGet(key)
    if (!week || typeof week !== 'object') continue
    for (const habitId of Object.keys(week)) {
      const days = week[habitId]
      if (!Array.isArray(days)) continue
      const set = doneByHabit[habitId] || (doneByHabit[habitId] = new Set())
      for (const day of days) set.add(day)
    }
  }
  const gymDates = new Set((storeGet('gym_workout_logs') || []).map(l => l.date))
  return { habits, doneByHabit, gymDates }
}

function isDone(habit, day, doneByHabit, gymDates) {
  if (habit.auto_source === 'gym') return gymDates.has(day)
  return doneByHabit[habit.id]?.has(day) || false
}

// Consecutive completed days counting back from today. Today not-yet-done does
// not zero the streak (grace day) — we then count back from yesterday.
function habitStreak(habit, today, doneByHabit, gymDates) {
  let cursor = isDone(habit, today, doneByHabit, gymDates) ? today : addDays(today, -1)
  let streak = 0
  while (streak < 999 && isDone(habit, cursor, doneByHabit, gymDates)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

// Adherence over the last 28 days, relative to the habit's weekly target
// (a 3×/week habit that hits 3 reads 100%). Capped at 100.
function adherence4wk(habit, today, doneByHabit, gymDates) {
  let done = 0
  for (let i = 0; i < 28; i++) {
    if (isDone(habit, addDays(today, -i), doneByHabit, gymDates)) done++
  }
  const target = Math.max(1, Math.min(7, habit.target_days_per_week || 7))
  const expected = target * 4
  return Math.round(Math.min(1, done / expected) * 100)
}

function heatColor(fraction) {
  if (fraction <= 0) return HEAT_NEUTRAL
  if (fraction <= 0.25) return HEAT_SCALE[0]
  if (fraction <= 0.5) return HEAT_SCALE[1]
  if (fraction <= 0.75) return HEAT_SCALE[2]
  return HEAT_SCALE[3]
}

function voiceFor(best) {
  if (best <= 0) return 'Every chain starts with day one.'
  if (best < 7) return 'Chains are built daily.'
  if (best < 21) return "The chain's getting strong."
  if (best < 60) return "Don't break the chain."
  return 'Unbreakable.'
}

export default function HabitStatsCard({ size, bp }) {
  const [{ habits, doneByHabit, gymDates }, setData] = useState(loadData)

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
  const compact = size !== 'XL'

  // ── Empty state ──
  if (habits.length === 0) {
    return (
      <div className="dc-goals-cell">
        <div className="goals-section-label">Habit Analytics</div>
        <div className="habitstats-micro-copy">Chains are built daily.</div>
        <div className="habitstats-card">
          <div className="habitstats-empty">
            No habits yet. Add a few on the Habits card to start building streaks.
          </div>
        </div>
      </div>
    )
  }

  // Per-habit stats, strongest streak first (so the compact L view surfaces the best).
  const stats = habits
    .map(h => ({
      habit: h,
      streak: habitStreak(h, today, doneByHabit, gymDates),
      pct: adherence4wk(h, today, doneByHabit, gymDates),
    }))
    .sort((a, b) => b.streak - a.streak || b.pct - a.pct)

  const best = stats.length ? stats[0].streak : 0
  const maxRows = compact ? 2 : 7
  const rows = stats.slice(0, maxRows)
  const moreCount = stats.length - rows.length

  // ── Heatmap: weeks as columns (oldest → newest), Mon→Sun down each column ──
  const weeks = weekCount(size, bp)
  const leftmostMonday = addDays(mondayOf(today), -(weeks - 1) * 7)
  const cells = []
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(leftmostMonday, w * 7)
    for (let r = 0; r < 7; r++) {
      const day = addDays(monday, r)
      const future = day > today
      let frac = 0
      if (!future) {
        let done = 0
        for (const h of habits) if (isDone(h, day, doneByHabit, gymDates)) done++
        frac = habits.length ? done / habits.length : 0
      }
      cells.push({ day, future, frac })
    }
  }

  return (
    <div className="dc-goals-cell">
      <div className="goals-section-label">Habit Analytics</div>
      <div className="habitstats-micro-copy">{voiceFor(best)}</div>
      <div className={`habitstats-card${compact ? ' habitstats-card--compact' : ''}`}>
        <div className={`habitstats-body${!compact && bp !== 'mobile' ? ' habitstats-body--wide' : ''}`}>
          <div className="habitstats-left">
            <div className="habitstats-hero">
              <span className="habitstats-hero-num">{best}</span>
              <span className="habitstats-hero-label">day streak</span>
            </div>
            <div className="habitstats-rows">
              {rows.map(({ habit, streak, pct }) => (
                <div className="habitstats-row" key={habit.id}>
                  <span className="habit-dot" style={{ background: domainColor(habit.domain) }} />
                  <span className="habitstats-row-name">{habit.name}</span>
                  <span className="habitstats-row-streak" data-live={streak > 0 ? '1' : '0'}>
                    {streak}<span className="habitstats-row-unit">d</span>
                  </span>
                  <span className="habitstats-row-pct">{pct}%</span>
                </div>
              ))}
              {moreCount > 0 && <div className="habitstats-more">+{moreCount} more</div>}
            </div>
          </div>

          <div className="habitstats-heatwrap">
            <div className="habitstats-heat">
              {cells.map((c) => (
                <span
                  key={c.day}
                  className={`habitstats-cell${c.future ? ' habitstats-cell--future' : ''}`}
                  style={{ background: heatColor(c.frac) }}
                  title={c.future ? c.day : `${c.day} · ${Math.round(c.frac * 100)}% of habits`}
                />
              ))}
            </div>
            {!compact && (
              <div className="habitstats-legend">
                <span>Less</span>
                <span className="habitstats-legend-cells">
                  {LEGEND_SWATCHES.map((bg, i) => (
                    <span key={i} className="habitstats-legend-cell" style={{ background: bg }} />
                  ))}
                </span>
                <span>More</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
