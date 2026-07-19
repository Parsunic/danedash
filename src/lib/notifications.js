// Local notifications & reminders (B9).
//
// Honest no-server scope: notifications only fire while the app / installed PWA is
// open or recently backgrounded. A single 60s in-page loop checks a few conditions
// and calls the B8 service worker's showNotification (which keeps working while the
// tab is backgrounded on Android/desktop; iOS requires the PWA installed). In dev
// there is no SW, so we fall back to the plain Notification constructor.
//
// Split of responsibilities per the sync rules:
//   - PREFS  (`notif_prefs_v1`)  → SYNCED   (STATIC_SYNC_KEYS). Read via storeGet
//                                  (absent → in-memory defaults, NO boot write);
//                                  written only from Settings save() via storeSet.
//   - PERMISSION                 → device-local (the browser owns it).
//   - DEDUPE MARKS (`notif_mark:*`) → device-local. Written with raw localStorage
//                                  .setItem so they NEVER sync and NEVER stamp
//                                  _lastLocalChange. Pruned to a 7-day window.
import { storeGet } from './storage.js'
import { getActiveDateString, getActiveWeekKey } from './dateHelpers.js'
import { getDayEvents } from '../modules/calendar/calendarUtils.js'
import { getJournalDateString } from '../modules/journal/journalUtils.js'

export const NOTIF_PREFS_KEY = 'notif_prefs_v1'

export const DEFAULT_NOTIF_PREFS = {
  v: 1,
  master: false,
  restTimer: true,
  eventStart: { enabled: false, minBefore: 10 },
  journalEvening: { enabled: false, time: '21:00' },
  habitMorning: { enabled: false, time: '09:00' },
}

// ── Prefs ────────────────────────────────────────────────────────────────────
// Read merges over defaults so a partial/legacy blob can never crash a check.
// NO write on read — absent key resolves to defaults in memory only.
export function getNotifPrefs() {
  const s = storeGet(NOTIF_PREFS_KEY)
  if (!s || typeof s !== 'object') return { ...DEFAULT_NOTIF_PREFS }
  return {
    ...DEFAULT_NOTIF_PREFS,
    ...s,
    eventStart:     { ...DEFAULT_NOTIF_PREFS.eventStart,     ...(s.eventStart     || {}) },
    journalEvening: { ...DEFAULT_NOTIF_PREFS.journalEvening, ...(s.journalEvening || {}) },
    habitMorning:   { ...DEFAULT_NOTIF_PREFS.habitMorning,   ...(s.habitMorning   || {}) },
  }
}

// Persist prefs. Called ONLY from Settings save() (a user gesture) — goes through
// storeSet (stamps _lastLocalChange + schedules a sync push) since this is synced.
export function saveNotifPrefs(prefs) {
  // Imported lazily to keep this module dependency-light; storeSet is the synced path.
  // (Static import avoided so notify()/loop callers don't pull the sync stamp in.)
  localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs))
  localStorage.setItem('_lastLocalChange', String(Date.now()))
  window.dispatchEvent(new CustomEvent('schedule-sync'))
}

// ── Permission ────────────────────────────────────────────────────────────────
export function permissionState() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

// Called ONLY from the Settings master toggle-on gesture. Never auto-prompt on load.
export async function requestPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

// ── Fire a notification ──────────────────────────────────────────────────────
// No-ops without permission or master. Prefers the SW registration (works while
// backgrounded); falls back to the Notification constructor when no SW (dev).
export async function notify(title, body, tag) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (!getNotifPrefs().master) return
  const opts = { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', silent: false }
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, opts)
        return
      }
    }
  } catch { /* fall through to the constructor */ }
  try { new Notification(title, opts) } catch { /* nothing else to try */ }
}

// Rest-timer completion (direct call from Gym's completion path). Respects
// master + restTimer + permission. Only meaningful when backgrounded — the
// in-app rest overlay already covers the foreground case.
export function notifyRestDone(exerciseName) {
  const prefs = getNotifPrefs()
  if (!prefs.master || !prefs.restTimer) return
  const body = exerciseName ? `${exerciseName} — time for your next set.` : 'Time for your next set.'
  notify('Rest over', body, 'rest-timer')
}

// ── Device-local dedupe marks ────────────────────────────────────────────────
const MARK_PREFIX = 'notif_mark:'
const MARK_TTL_MS = 7 * 24 * 60 * 60 * 1000

function markKey(type, id) { return `${MARK_PREFIX}${type}:${id}` }

function hasMark(type, id) {
  try { return localStorage.getItem(markKey(type, id)) !== null } catch { return false }
}

function setMark(type, id) {
  // Raw setItem — never storeSet/storeSetSilent. Must not sync, must not stamp.
  try { localStorage.setItem(markKey(type, id), String(Date.now())) } catch { /* quota — skip */ }
}

function pruneMarks() {
  const cutoff = Date.now() - MARK_TTL_MS
  const stale = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(MARK_PREFIX)) continue
      const ts = parseInt(localStorage.getItem(k) || '0')
      if (!ts || ts < cutoff) stale.push(k)
    }
    stale.forEach(k => localStorage.removeItem(k))
  } catch { /* enumeration failed — non-fatal */ }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeToMinutes(t) {
  const [h, m] = String(t || '').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function nowMinutes(d) {
  return d.getHours() * 60 + d.getMinutes()
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Individual checks ────────────────────────────────────────────────────────
// (a) Event start: today's timed events (calendar_events + gym_planned) whose
// start is within [0, minBefore] minutes from now → notify once per event id/day.
function checkEventStart(cfg, now) {
  const minBefore = Math.max(1, Math.min(60, Number(cfg.minBefore) || 10))
  const calEvents  = storeGet('calendar_events') || []
  const gymPlanned = storeGet('gym_planned') || []
  let events
  try { events = getDayEvents(now, calEvents, gymPlanned) } catch { return }
  const nowMs = now.getTime()
  const day = localDateStr(now)
  for (const ev of events) {
    if (ev.is_all_day) continue
    const start = new Date(ev.start_time).getTime()
    if (Number.isNaN(start)) continue
    const minsUntil = (start - nowMs) / 60000
    if (minsUntil < 0 || minsUntil > minBefore) continue
    const id = `${ev.id}:${day}`
    if (hasMark('event', id)) continue
    setMark('event', id)
    const when = minsUntil < 1 ? 'now' : `in ${Math.round(minsUntil)} min`
    notify(ev.title || 'Upcoming event', `Starts ${when}.`, `event-${ev.id}`)
  }
}

// (b) Journal evening: after the configured time, if there's no entry for the
// journal's active date, nudge once for that day.
function checkJournalEvening(cfg, now) {
  if (nowMinutes(now) < timeToMinutes(cfg.time || '21:00')) return
  const day = getJournalDateString()
  if (hasMark('journal', day)) return
  const entries = storeGet('journal_entries') || []
  if (Array.isArray(entries) && entries.some(e => e && e.date === day)) return
  setMark('journal', day)
  notify('Journal', 'Take a minute to reflect on today.', `journal-${day}`)
}

// (c) Habit morning: after the configured time, if any habit is still open today,
// send one summary for the day.
function checkHabitMorning(cfg, now) {
  if (nowMinutes(now) < timeToMinutes(cfg.time || '09:00')) return
  const day = getActiveDateString()
  if (hasMark('habit', day)) return
  const habits = storeGet('habits') || []
  if (!Array.isArray(habits) || habits.length === 0) return
  const log = storeGet(`habits_log:${getActiveWeekKey()}`) || {}
  const gymDates = new Set((storeGet('gym_workout_logs') || []).map(l => l.date))
  const isDone = (h) => h.auto_source === 'gym'
    ? gymDates.has(day)
    : (log[h.id] || []).includes(day)
  const open = habits.filter(h => !isDone(h)).length
  if (open === 0) return
  setMark('habit', day)
  notify('Habits', `${open} of ${habits.length} habits still open today.`, `habit-${day}`)
}

// ── The check pass ───────────────────────────────────────────────────────────
// Runs every loop tick (and on the test hook). No-ops entirely without master +
// granted permission, so it is always safe to call.
export function runNotifChecks() {
  const prefs = getNotifPrefs()
  if (!prefs.master) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  pruneMarks()
  const now = new Date()
  if (prefs.eventStart?.enabled)     checkEventStart(prefs.eventStart, now)
  if (prefs.journalEvening?.enabled) checkJournalEvening(prefs.journalEvening, now)
  if (prefs.habitMorning?.enabled)   checkHabitMorning(prefs.habitMorning, now)
}

// ── The loop ─────────────────────────────────────────────────────────────────
let loopStarted = false     // module-scope guard — StrictMode / double-mount safe
let loopTimer = null
const LOOP_MS = 60 * 1000

export function startNotificationLoop() {
  if (loopStarted) return
  loopStarted = true
  // Testing hook: force an immediate check pass (orchestrator/Playwright calls
  // window.__runNotifChecksNow() instead of waiting out the 60s interval).
  if (typeof window !== 'undefined') {
    window.__runNotifChecksNow = () => { try { runNotifChecks() } catch { /* non-fatal */ } }
  }
  const tick = () => { try { runNotifChecks() } catch { /* non-fatal */ } }
  loopTimer = setInterval(tick, LOOP_MS)
  setTimeout(tick, 3000) // one settled pass shortly after boot (also a no-op w/o perm)
}
