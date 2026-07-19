// ── F5 Task Timeboxing — pure helpers ──
// No writes, no side effects. Reads goals from localStorage (read-only) and
// derives free windows / suggested placements from in-memory event lists.
import { storeGet } from '../../lib/storage.js'
import { getActiveDateString } from '../../lib/dateHelpers.js'
import { isSameDay } from './calendarUtils.js'

export const TIMEBOX_DEFAULTS = { dayStart: '08:00', dayEnd: '22:00', blockMin: 45, gapMin: 10 }

function timeStrToMins(str) {
  const [h, m] = String(str).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const snapUp15 = (m) => Math.ceil(m / 15) * 15
const snapDown15 = (m) => Math.floor(m / 15) * 15

// Today's undone goals, ⚡ queued first, excluding goals already timeboxed
// (any calendar event carrying a matching source_goal_id — goal ids are
// unique per day, so cross-day placements also count as "scheduled").
export function getUnscheduledTasks(calEvents) {
  const events = calEvents || storeGet('calendar_events') || []
  const goals = storeGet(`goals:${getActiveDateString()}`) || []

  const boxed = new Set()
  for (const ev of events) {
    if (ev && ev.source_goal_id) boxed.add(ev.source_goal_id)
  }

  const open = goals.filter(g => g && !g.done && !boxed.has(g.id))
  return [...open.filter(g => g.queued), ...open.filter(g => !g.queued)]
}

// Open {start,end} windows (minutes from midnight) between dayStart and dayEnd,
// avoiding the given day's timed events padded by gapMin, snapped inward to
// 15-minute marks. Only windows that fit at least one blockMin block survive.
export function findFreeSlots(dayEvents, opts = {}) {
  const { dayStart, dayEnd, blockMin, gapMin } = { ...TIMEBOX_DEFAULTS, ...opts }
  const startMin = timeStrToMins(dayStart)
  const endMin = timeStrToMins(dayEnd)

  const busy = (dayEvents || [])
    .filter(ev => ev && !ev.is_all_day && ev.start_time && ev.end_time)
    .map(ev => {
      const s = new Date(ev.start_time)
      const e = new Date(ev.end_time)
      const sm = s.getHours() * 60 + s.getMinutes()
      const em = Math.max(sm + 1, e.getHours() * 60 + e.getMinutes())
      return [Math.max(0, sm - gapMin), Math.min(24 * 60, em + gapMin)]
    })
    .sort((a, b) => a[0] - b[0])

  const merged = []
  for (const iv of busy) {
    const last = merged[merged.length - 1]
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1])
    else merged.push([iv[0], iv[1]])
  }

  const windows = []
  let cursor = startMin
  for (const [bs, be] of merged) {
    if (be <= cursor) continue
    if (bs >= endMin) break
    if (bs > cursor) windows.push({ start: cursor, end: Math.min(bs, endMin) })
    cursor = Math.max(cursor, be)
    if (cursor >= endMin) break
  }
  if (cursor < endMin) windows.push({ start: cursor, end: endMin })

  return windows
    .map(w => ({ start: snapUp15(w.start), end: snapDown15(w.end) }))
    .filter(w => w.end - w.start >= blockMin)
}

// Greedy packing: queued tasks first into the earliest free slots, blockMin
// blocks with gapMin breathing room, never before "now" when date is today.
// Returns [{ goalId, title, start_time, end_time }] with ISO times on `date`.
export function suggestPlacements(tasks, dayEvents, date, opts = {}) {
  const { blockMin, gapMin } = { ...TIMEBOX_DEFAULTS, ...opts }
  const list = tasks || []
  if (!list.length) return []

  const day = new Date(date)
  const now = new Date()
  const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59)
  if (endOfDay < now) return [] // entire day already in the past

  const nowFloor = isSameDay(day, now)
    ? snapUp15(now.getHours() * 60 + now.getMinutes())
    : 0

  const slots = findFreeSlots(dayEvents, opts)
    .map(s => ({ start: snapUp15(Math.max(s.start, nowFloor)), end: s.end }))
    .filter(s => s.end - s.start >= blockMin)

  if (!slots.length) return []

  const mk = (m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60)
  const ordered = [...list.filter(t => t.queued), ...list.filter(t => !t.queued)]

  const out = []
  let si = 0
  let cursor = slots[0].start
  for (const task of ordered) {
    while (si < slots.length && cursor + blockMin > slots[si].end) {
      si++
      if (si < slots.length) cursor = slots[si].start
    }
    if (si >= slots.length) break
    out.push({
      goalId: task.id,
      title: task.text,
      start_time: mk(cursor).toISOString(),
      end_time: mk(cursor + blockMin).toISOString(),
    })
    cursor = snapUp15(cursor + blockMin + gapMin)
  }
  return out
}
