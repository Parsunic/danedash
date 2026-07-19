// Deterministic quick-add parsing + execution for the command palette (B7).
// NO AI — regex only. Writes go through the same storeSet paths the modules use,
// so cross-device sync (schedule-sync → SyncContext) and in-app refresh events fire
// automatically. See CLAUDE.md "Cross-Device Sync" and the Calendar/Journal shapes.

import { storeGet, storeSet } from './storage.js'
import { getActiveDateString, getTomorrowDateString } from './dateHelpers.js'
import { JOURNAL_KEY, getJournalDateString, isEntryLocked } from '../modules/journal/journalUtils.js'

const uuid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

// name → day-of-week (0=Sun). Longer aliases are listed first so `\bsun\b` never
// pre-empts `\bsunday\b` (each is matched by its own word-boundary regex anyway).
const WEEKDAYS = [
  ['sunday', 0], ['tuesday', 2], ['wednesday', 3], ['thursday', 4],
  ['saturday', 6], ['monday', 1], ['friday', 5],
  ['tues', 2], ['thurs', 4],
  ['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6],
]

// ── time / day formatters (shared by preview + confirmation) ──

function fmtTime(d) {
  const h = d.getHours(), m = d.getMinutes()
  const ap = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}

function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dd = new Date(d); dd.setHours(0, 0, 0, 0)
  const diff = Math.round((dd - today) / 86400000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (diff > 1 && diff <= 7) return dd.toLocaleDateString('en-US', { weekday: 'long' })
  return dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── event grammar ──
// `<title> [today|tomorrow|weekday] [time] [for <duration>]` — tokens may appear
// in any order; whatever is left after stripping recognised tokens is the title.
// Time forms: `3pm`, `3:30pm`, `15:00` (24h), `at 3` / trailing `3` when a day is
// given (24h). No time → next full hour. Duration default 60m.
function parseEvent(remainder) {
  const now = new Date()
  let str = ` ${String(remainder || '').trim()} `
  let dayOffset = null
  let hour = null, minute = 0
  let durationMin = 60

  // duration — "for 45m" / "for 1h" / "for 90 minutes"
  const dm = str.match(/\bfor\s+(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i)
  if (dm) {
    const n = parseInt(dm[1], 10)
    durationMin = dm[2].toLowerCase().startsWith('h') ? n * 60 : n
    if (!durationMin || durationMin < 1) durationMin = 60
    str = str.replace(dm[0], ' ')
  }

  // day — today / tomorrow / weekday (next occurrence; today's own weekday = today)
  const tmrw = /\b(tomorrow|tmrw|tmw)\b/i
  if (/\btoday\b/i.test(str)) { dayOffset = 0; str = str.replace(/\btoday\b/i, ' ') }
  else if (tmrw.test(str)) { dayOffset = 1; str = str.replace(tmrw, ' ') }
  else {
    for (const [name, dow] of WEEKDAYS) {
      const re = new RegExp(`\\b${name}\\b`, 'i')
      if (re.test(str)) { dayOffset = (dow - now.getDay() + 7) % 7; str = str.replace(re, ' '); break }
    }
  }

  // time — am/pm, then 24h colon, then bare hour (explicit "at" or trailing + a day)
  const ap = str.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i)
  if (ap) {
    hour = (parseInt(ap[1], 10) % 12) + (ap[3].toLowerCase() === 'p' ? 12 : 0)
    minute = ap[2] ? parseInt(ap[2], 10) : 0
    str = str.replace(ap[0], ' ')
  } else {
    const colon = str.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/)
    if (colon) {
      hour = parseInt(colon[1], 10); minute = parseInt(colon[2], 10)
      str = str.replace(colon[0], ' ')
    } else {
      let bare = str.match(/\bat\s+(\d{1,2})\b/i)
      if (!bare && dayOffset !== null) bare = str.match(/\s(\d{1,2})\s*$/)
      if (bare) { hour = parseInt(bare[1], 10); minute = 0; str = str.replace(bare[0], ' ') }
    }
  }

  const start = new Date(now)
  if (dayOffset !== null) start.setDate(start.getDate() + dayOffset)
  if (hour === null) start.setHours(now.getHours() + 1, 0, 0, 0)          // next full hour
  else start.setHours(Math.min(23, Math.max(0, hour)), Math.min(59, Math.max(0, minute)), 0, 0)
  const end = new Date(start.getTime() + durationMin * 60000)

  // leftover 'at'/'on' scheduling filler is dropped from the title
  const title = str.replace(/\b(?:at|on)\b/gi, ' ').replace(/\s+/g, ' ').trim()

  return { title, start, end, durationMin }
}

// parseQuickAdd(input) → { kind: 'task'|'task-tomorrow'|'event'|'journal'|null, payload }
// A prefix is a single letter (t/tm/e/j) followed by whitespace. Empty remainders
// still resolve to their kind so the palette can show a "keep typing" hint.
export function parseQuickAdd(input) {
  const raw = String(input || '')
  let m
  if ((m = raw.match(/^tm\s([\s\S]*)$/i))) return { kind: 'task-tomorrow', payload: { text: m[1].trim() } }
  if ((m = raw.match(/^t\s([\s\S]*)$/i)))  return { kind: 'task',          payload: { text: m[1].trim() } }
  if ((m = raw.match(/^e\s([\s\S]*)$/i)))  return { kind: 'event',         payload: parseEvent(m[1]) }
  if ((m = raw.match(/^j\s([\s\S]*)$/i)))  return { kind: 'journal',       payload: { text: m[1].trim() } }
  return { kind: null, payload: null }
}

// True when the parse has enough to write (non-empty text / event title).
export function canExecute(parsed) {
  if (!parsed || !parsed.kind) return false
  if (parsed.kind === 'event') return !!(parsed.payload && parsed.payload.title)
  return !!(parsed.payload && parsed.payload.text)
}

// Preview string for the palette's action row (pure — no writes).
export function describeQuickAdd(parsed) {
  if (!parsed || !parsed.kind) return null
  const { kind, payload } = parsed
  if (kind === 'task')          return payload.text ? `Add task today — ${payload.text}`    : 'Type a task…'
  if (kind === 'task-tomorrow') return payload.text ? `Add task tomorrow — ${payload.text}` : 'Type a task…'
  if (kind === 'journal')       return payload.text ? `Add journal line — ${payload.text}`  : 'Type a journal line…'
  if (kind === 'event') {
    if (!payload.title) return 'Type an event…'
    return `Event — ${payload.title} · ${dayLabel(payload.start)} ${fmtTime(payload.start)} · ${payload.durationMin}m`
  }
  return null
}

// executeQuickAdd(parsed) → performs ONE storeSet write, returns a confirmation string
// (or null when there's nothing to write). Mirrors each module's persisted shape exactly.
export function executeQuickAdd(parsed) {
  if (!canExecute(parsed)) return null
  const { kind, payload } = parsed

  if (kind === 'task' || kind === 'task-tomorrow') {
    const date = kind === 'task' ? getActiveDateString() : getTomorrowDateString()
    const key = `goals:${date}`
    const arr = storeGet(key) || []
    arr.push({ id: uuid(), text: payload.text.trim(), done: false })
    storeSet(key, arr) // dispatches goals-changed + schedule-sync
    return kind === 'task' ? 'Task added for today' : 'Task added for tomorrow'
  }

  if (kind === 'event') {
    // Mirror Calendar.handleEventSave's created shape (module_tag intentionally omitted).
    const arr = storeGet('calendar_events') || []
    arr.push({
      id: uuid(),
      user_id: 'dane',
      title: payload.title.trim(),
      description: '',
      start_time: payload.start.toISOString(),
      end_time: payload.end.toISOString(),
      is_all_day: false,
      created_at: new Date().toISOString(),
    })
    storeSet('calendar_events', arr) // dispatches schedule-sync → Calendar refresh + sync push
    return `Event '${payload.title.trim()}' ${dayLabel(payload.start)} ${fmtTime(payload.start)}`
  }

  if (kind === 'journal') {
    const text = payload.text.trim()
    const entries = storeGet(JOURNAL_KEY) || []
    const todayStr = getJournalDateString()
    const idx = entries.findIndex(e => e.date === todayStr)
    if (idx !== -1 && !isEntryLocked(entries[idx])) {
      // Append to today's still-unlocked entry (24h lock rule from journalUtils).
      const updated = entries.map((e, i) => i === idx ? { ...e, text: `${e.text || ''}\n\n${text}` } : e)
      storeSet(JOURNAL_KEY, updated)
      return 'Added to today’s journal'
    }
    // Otherwise create a fresh entry — mirrors Journal.saveEntry (prepend, newest first).
    const newEntry = { id: uuid(), date: todayStr, created_at: new Date().toISOString(), text, tags: [] }
    storeSet(JOURNAL_KEY, [newEntry, ...entries])
    return 'Journal entry created'
  }

  return null
}
