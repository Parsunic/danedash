import { storeGet } from '../../lib/storage.js'
import { getActiveDateString, getActiveWeekKey } from '../../lib/dateHelpers.js'
import { getLatest } from '../../lib/bodyMetrics.js'
import { fetchHealthHistory } from '../health/googleFitSync.js'
import { isEntryLocked } from '../journal/journalUtils.js'

// Parameterized dynamic-context builder for the Overseer Terminal.
// Honors the per-source budgets in overseer_config_v1.context. Read-only:
// localStorage via storeGet + Supabase GETs (health history). Never writes.
// Quick mode = goals + habits only (slim, fast). Every source is individually
// fault-isolated so one bad store never blanks the whole context.

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function activeDateObj() {
  const [y, m, d] = getActiveDateString().split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Monday-start week of the active date (mirrors HabitsSection.getWeekDays).
function weekDayStrs() {
  const base = activeDateObj()
  const dow = base.getDay() || 7
  const days = []
  for (let i = 0; i < 7; i++) {
    days.push(localDateStr(new Date(base.getFullYear(), base.getMonth(), base.getDate() - (dow - 1) + i)))
  }
  return days
}

function goalsSection(goalsDays) {
  const base = activeDateObj()
  const lines = []
  for (let i = 0; i <= goalsDays; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
    const ds = localDateStr(d)
    const goals = storeGet(`goals:${ds}`) || []
    if (!goals.length) continue
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : ds
    lines.push(`${label}:\n` + goals.map(g => `${g.done ? '✓' : '○'} ${g.text}${g.queued ? ' ⚡' : ''}`).join('\n'))
  }
  return lines.length ? '\n### Tasks\n' + lines.join('\n\n') : ''
}

function habitsSection(gymLogDates) {
  const habits = storeGet('habits') || []
  if (!habits.length) return ''
  const week = weekDayStrs()
  const log = storeGet(`habits_log:${getActiveWeekKey()}`) || {}
  const lines = habits.map(h => {
    const days = h.auto_source === 'gym'
      ? week.filter(d => gymLogDates.has(d))
      : (log[h.id] || []).filter(d => week.includes(d))
    return `${h.name}: ${days.length}/7 this week${h.auto_source === 'gym' ? ' (auto: gym)' : ''}`
  })
  return '\n### Habits (this week)\n' + lines.join('\n')
}

function gymSection(gymDays, logs) {
  if (!gymDays) return ''
  const base = activeDateObj()
  const cutoff = localDateStr(new Date(base.getFullYear(), base.getMonth(), base.getDate() - (gymDays - 1)))
  const recent = logs
    .filter(l => (l.date || '') >= cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 14)
  if (!recent.length) return ''
  const lines = recent.map(l => {
    const exs = (l.exercises || []).slice(0, 8).map(ex => {
      const sets = Array.isArray(ex.sets) ? ex.sets : []
      const vol = Math.round(sets.reduce((s, x) => s + (Number(x.weight) || 0) * (Number(x.reps) || 0), 0))
      return `${ex.name} ${sets.length}×${vol ? ` vol ${vol}` : ''}`
    })
    return `[${l.date}] ${exs.join('; ')}`
  })
  return `\n### Gym (last ${gymDays} days)\n` + lines.join('\n')
}

function journalSection(journalEntries) {
  if (!journalEntries) return ''
  const entries = (storeGet('journal_entries') || [])
    .filter(e => e && e.content && !isEntryLocked(e))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, journalEntries)
  if (!entries.length) return ''
  const lines = entries.map(e => {
    const text = String(e.content)
    return `[${(e.date || (e.created_at || '').slice(0, 10))}] ${text.slice(0, 220)}${text.length > 220 ? '…' : ''}`
  })
  return `\n### Journal (last ${entries.length} unlocked entries)\n` + lines.join('\n')
}

async function healthSection(healthDays) {
  if (!healthDays) return ''
  let rows = []
  try { rows = await fetchHealthHistory(healthDays) } catch { return '' }
  if (!rows.length) return ''
  const avg = (key) => {
    const vals = rows.map(r => Number(r[key])).filter(v => Number.isFinite(v) && v > 0)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const last = rows[rows.length - 1]
  const parts = []
  const aS = avg('sleep_score'), aH = avg('hrv'), aR = avg('resting_hr'), aSt = avg('steps')
  const avgBits = []
  if (aS != null) avgBits.push(`sleep ${aS}`)
  if (aH != null) avgBits.push(`HRV ${aH}ms`)
  if (aR != null) avgBits.push(`RHR ${aR}`)
  if (aSt != null) avgBits.push(`steps ${(aSt / 1000).toFixed(1)}k`)
  if (avgBits.length) parts.push(`${healthDays}-day avg: ${avgBits.join(' · ')}`)
  if (last) {
    const lastBits = []
    if (last.sleep_score) lastBits.push(`sleep ${last.sleep_score}`)
    if (last.hrv) lastBits.push(`HRV ${last.hrv}ms`)
    if (last.resting_hr) lastBits.push(`RHR ${last.resting_hr}`)
    if (last.steps) lastBits.push(`steps ${last.steps}`)
    if (lastBits.length) parts.push(`latest (${last.date}): ${lastBits.join(' · ')}`)
  }
  return parts.length ? `\n### Health (${healthDays} days)\n` + parts.join('\n') : ''
}

function calendarSection(calendarDays) {
  if (!calendarDays) return ''
  const base = activeDateObj()
  const startMs = base.getTime()
  const endMs = startMs + (calendarDays + 1) * 86400000
  const lines = []
  const events = (storeGet('calendar_events') || [])
    .filter(e => {
      const t = new Date(e.start_time).getTime()
      return Number.isFinite(t) && t >= startMs && t < endMs
    })
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 20)
  events.forEach(e => {
    const d = new Date(e.start_time)
    const when = e.is_all_day
      ? `${localDateStr(d)} all-day`
      : `${localDateStr(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    lines.push(`[${when}] ${e.title}`)
  })
  const planned = (storeGet('gym_planned') || [])
    .filter(p => {
      if (!p.date) return false
      const ds = p.date
      const endStr = localDateStr(new Date(base.getFullYear(), base.getMonth(), base.getDate() + calendarDays))
      return ds >= localDateStr(base) && ds <= endStr
    })
    .slice(0, 10)
  planned.forEach(p => lines.push(`[${p.date}] planned workout: ${p.name}${p.status ? ` (${p.status})` : ''}`))
  return lines.length ? `\n### Calendar (next ${calendarDays} days)\n` + lines.join('\n') : ''
}

function bodySection() {
  try {
    const latest = getLatest()
    if (!latest) return ''
    let line = `Latest weigh-in: ${latest.weight} ${latest.unit} (${latest.date})`
    if (latest.waist) line += ` · waist ${latest.waist}`
    return '\n### Body\n' + line
  } catch { return '' }
}

// → string ('' allowed). config = sanitized overseer_config_v1. quick → slim.
export async function buildTerminalContext(config, { quick = false } = {}) {
  const c = config.context
  const parts = ['\n\n## Live DaneDash context (injected now)']

  const gymLogs = Array.isArray(storeGet('gym_workout_logs')) ? storeGet('gym_workout_logs') : []
  const gymLogDates = new Set(gymLogs.map(l => l.date))

  try { const s = goalsSection(c.goalsDays); if (s) parts.push(s) } catch {}
  if (c.habits) { try { const s = habitsSection(gymLogDates); if (s) parts.push(s) } catch {} }

  if (!quick) {
    try { const s = gymSection(c.gymDays, gymLogs); if (s) parts.push(s) } catch {}
    try { const s = journalSection(c.journalEntries); if (s) parts.push(s) } catch {}
    try { const s = await healthSection(c.healthDays); if (s) parts.push(s) } catch {}
    try { const s = calendarSection(c.calendarDays); if (s) parts.push(s) } catch {}
    try { const s = bodySection(); if (s) parts.push(s) } catch {}
  }

  return parts.join('')
}
