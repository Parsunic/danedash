// weeklyReviewUtils.js — pure aggregation for the Weekly Review ritual (B5).
//
// Everything here is DERIVED from existing localStorage sources at read time and
// NEVER persisted (the one persisted key, `weekly_reviews_v1`, is written by the
// overlay's "Mark week reviewed" gesture, not here). No AI.
//
// Sources: goals:* day lists, `habits` + all `habits_log:*` weekly logs
// (union → per-habit completed date set, matching HabitStatsCard EXACTLY,
// including the auto_source==='gym' rule), `gym_workout_logs` (volume via the
// shared readinessUtils.logVolume so the number can't drift from the gym stats),
// `gym_exercise_history` (new-e1RM PRs), `journal_entries` (count + avg mood),
// and `calendar_events` (count). Handles sparse/missing data throughout.

import { storeGet, storeListKeys } from '../../lib/storage.js'
import { getActiveDateString } from '../../lib/dateHelpers.js'
import { logVolume } from '../health/readinessUtils.js'

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

// Mon–Sun week bounds. offset 0 = current week, -1 = last week, +1 = next week.
// key is an ISO-style 'YYYY-Wnn' derived from the week's Thursday, matching the
// convention in dateHelpers.getActiveWeekKey.
export function weekBounds(offset = 0) {
  const [y, m, d] = getActiveDateString().split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() || 7 // Mon=1 … Sun=7
  const monday = new Date(y, m - 1, d - (dow - 1) + offset * 7)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  const thu = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3)
  const jan1 = new Date(thu.getFullYear(), 0, 1)
  const week = Math.ceil(((thu - jan1) / 86400000 + 1) / 7)
  return {
    start: localDateStr(monday),
    end: localDateStr(sunday),
    key: `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`,
  }
}

// The 7 Mon→Sun date strings of a week.
export function weekDays(bounds) {
  const [y, m, d] = bounds.start.split('-').map(Number)
  const out = []
  for (let i = 0; i < 7; i++) out.push(localDateStr(new Date(y, m - 1, d + i)))
  return out
}

// The upcoming Monday relative to the active date — today if today is Monday.
// This is the landing spot for "push unfinished" and "add goal for the week"
// so leftovers always fall on a fresh, non-past start (never corrupting the
// goal streak by dropping undone tasks onto a past date).
export function nextMondayStr() {
  const [y, m, d] = getActiveDateString().split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() || 7 // Mon=1 … Sun=7
  const delta = dow === 1 ? 0 : 8 - dow
  return localDateStr(new Date(y, m - 1, d + delta))
}

// Undone goals (that carry an id) from the reviewed week's day lists, deduped by
// id, oldest day first. Only id-bearing goals are eligible to be pushed forward.
export function undoneGoals(bounds) {
  const seen = new Set()
  const out = []
  for (const day of weekDays(bounds)) {
    const arr = storeGet('goals:' + day) || []
    for (const g of arr) {
      if (g && !g.done && g.id && !seen.has(g.id)) {
        seen.add(g.id)
        out.push(g)
      }
    }
  }
  return out
}

// New-e1RM PRs achieved during the week: for each exercise in gym_exercise_history,
// walk its sessions oldest→newest tracking the running max e1RM; a session whose
// e1RM strictly exceeds every prior session is a PR, counted if its date is in-week.
function countPRs(bounds) {
  const hist = storeGet('gym_exercise_history') || {}
  let count = 0
  for (const name of Object.keys(hist)) {
    const sessions = (hist[name] && hist[name].sessions) || []
    const sorted = [...sessions]
      .filter(s => s && s.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    let maxE1rm = 0
    for (const s of sorted) {
      const e = s.e1rm || 0
      if (e > maxE1rm) {
        if (s.date >= bounds.start && s.date <= bounds.end) count++
        maxE1rm = e
      }
    }
  }
  return count
}

// Aggregate every tracked source for a Mon–Sun week.
// Returns { goals, habits, gym, journal, calendar } — all fields defined even
// when the underlying data is empty.
export function aggregateWeek(bounds) {
  const today = getActiveDateString()
  const days = weekDays(bounds)

  // ── Goals: done % across all 7 day lists + a per-day {done,total} for bars ──
  let gDone = 0, gTotal = 0
  const byDay = days.map(day => {
    const arr = storeGet('goals:' + day) || []
    const total = arr.length
    const done = arr.filter(g => g && g.done).length
    gDone += done
    gTotal += total
    return { date: day, done, total }
  })
  const goals = {
    done: gDone,
    total: gTotal,
    pct: gTotal ? Math.round((gDone / gTotal) * 100) : 0,
    byDay,
  }

  // ── Habits: union every habits_log:* into per-habit completed date sets ──
  const habitDefs = storeGet('habits') || []
  const doneByHabit = {}
  for (const key of storeListKeys('habits_log:')) {
    const wk = storeGet(key)
    if (!wk || typeof wk !== 'object') continue
    for (const hid of Object.keys(wk)) {
      const arr = wk[hid]
      if (!Array.isArray(arr)) continue
      const set = doneByHabit[hid] || (doneByHabit[hid] = new Set())
      for (const ds of arr) set.add(ds)
    }
  }
  const gymLogs = storeGet('gym_workout_logs') || []
  const gymDates = new Set(gymLogs.map(l => l && l.date))
  // Only count days that have actually elapsed (matters for the current week).
  const elapsed = days.filter(day => day <= today)
  const perHabit = habitDefs.map(h => {
    const target = Math.max(1, Math.min(7, h.target_days_per_week || 7))
    let completed = 0
    for (const day of elapsed) {
      const done = h.auto_source === 'gym'
        ? gymDates.has(day)
        : (doneByHabit[h.id]?.has(day) || false)
      if (done) completed++
    }
    return {
      id: h.id,
      name: h.name,
      domain: h.domain,
      completed,
      target,
      pct: Math.round(Math.min(1, completed / target) * 100),
    }
  })
  const habits = {
    adherencePct: perHabit.length ? Math.round(avg(perHabit.map(p => p.pct))) : null,
    perHabit,
  }

  // ── Gym: sessions + total volume (shared logVolume) + new-e1RM PRs ──
  const weekLogs = gymLogs.filter(l => l && l.date >= bounds.start && l.date <= bounds.end)
  const gym = {
    sessions: weekLogs.length,
    volume: Math.round(weekLogs.reduce((s, l) => s + logVolume(l), 0)),
    prCount: countPRs(bounds),
  }

  // ── Journal: entry count + avg mood (optional 1–5) ──
  const jEntries = (storeGet('journal_entries') || [])
    .filter(e => e && e.date >= bounds.start && e.date <= bounds.end)
  const moods = jEntries.filter(e => e.mood != null).map(e => e.mood)
  const journal = {
    entries: jEntries.length,
    avgMood: moods.length ? Math.round(avg(moods) * 10) / 10 : null,
  }

  // ── Calendar: event count (by local start day) ──
  const events = (storeGet('calendar_events') || []).filter(ev => {
    if (!ev || !ev.start_time) return false
    const d = new Date(ev.start_time)
    if (isNaN(d.getTime())) return false
    const ds = localDateStr(d)
    return ds >= bounds.start && ds <= bounds.end
  })
  const calendar = { events: events.length }

  return { goals, habits, gym, journal, calendar }
}
