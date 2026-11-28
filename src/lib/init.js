import { storeGet, storeSetSilent, storeListKeys } from './storage.js'
import { getItemTombs } from './syncMeta.js'
import { getActiveDateString } from './dateHelpers.js'

// ---------------------------------------------------------------------------
// Item identity — DETERMINISTIC, never crypto.randomUUID().
//
// The sync layer merges task lists item-by-item, keyed by `id`. Startup automation
// (rollover, recurring injection, id back-fill) runs independently on every device
// against the same data, so a random id would make each device mint a DIFFERENT id for
// the same logical task — and union-by-id would then show it twice. Deriving the id from
// the content makes both devices agree without talking to each other.
// ---------------------------------------------------------------------------
function normText(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Rolled-over task: same text landing on the same day is the same task, on any device.
const rolloverId = (date, text) => `ro:${date}:${normText(text)}`
// Recurring-task instance: one per (date, text).
const recurringId = (date, text) => `rc:${date}:${normText(text)}`
// Back-filled legacy row: position disambiguates repeated text within one list.
const backfillId = (index, text) => `bf:${index}:${normText(text)}`

// ---------------------------------------------------------------------------
// Back-fill `id` on task rows that predate it.
//
// Roughly half of the stored `goals:` lists contain rows with no `id` at all, and
// item-level merge cannot track an item it cannot name. Text alone will not do — editing
// a task changes its text, which a merge would read as delete + create.
//
// Runs before doRollover so everything downstream can assume ids exist. Writes silently:
// this is a normalization, not a user edit.
// ---------------------------------------------------------------------------
export function backfillItemIds() {
  const keys = [...storeListKeys('goals:'), 'general_tasks']
  keys.forEach(key => {
    const items = storeGet(key)
    if (!Array.isArray(items) || items.length === 0) return
    let changed = false
    const next = items.map((item, i) => {
      if (!item || typeof item !== 'object' || item.id) return item
      changed = true
      return { ...item, id: backfillId(i, item.text) }
    })
    if (changed) storeSetSilent(key, next)
  })
}

// ---------------------------------------------------------------------------
// Carry the last planned day's unfinished tasks into today — ONCE per day, permanently.
//
// This used to delete each past day after rolling it, without recording the deletion.
// The server kept its copy, the next pull put it back, and the next launch rolled it
// again — so a task you deleted returned on every single reload, forever. Deleting it
// harder could not help: the source day was being resurrected from the server each time.
//
// The fix is to remember which days have been retired instead of trying to erase them.
// The record syncs, so a day is rolled once across all your devices, and past days stay
// intact as history (the weekly review reads them).
//
// Two limits (Nov 2026). Rollover used to carry every unfinished task from EVERY
// unretired past day, forever. Tasks nobody ticked rode along for months, and when a
// device received an old day late (another device had rolled it quietly and only
// uploaded it days later) it dumped that whole backlog into today — 48 tasks, some from
// June, on top of the 7 that were actually current. So now:
//   - only the MOST RECENT unretired day is carried (older ones are still retired);
//   - a task is carried for at most CARRY_MAX_DAYS after the day it was first planned
//     (`since`). After that it stays on the days it was planned for, as history, and
//     stops following you around.
// ---------------------------------------------------------------------------
export const ROLLOVER_DONE_KEY = 'rollover_done_v1'
export const CARRY_MAX_DAYS = 7

const dayNumber = (dateStr) => {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from)

// The day a task was first planned. Carried tasks record it as `since`; tasks carried
// before that field existed are traced back through the days they were carried on
// (ids `ro:<day>:…`) to the day they were created (any other id). Days where the task
// is absent are skipped rather than ending the trace: a device that had not yet received
// a day could start the next one without it, which is exactly how the backlog hid.
// Ending at the creating day — not the first day the text ever appeared — means a task
// you add again later with the same wording counts from when you added it.
export function taskSince(task, dayStr, history) {
  if (task?.since) return task.since
  if (!String(task?.id || '').startsWith('ro:')) return dayStr
  const text = normText(task.text)
  let since = dayStr
  for (let i = history.length - 1; i >= 0; i--) {
    const [d, list] = history[i]
    if (d >= dayStr) continue
    const hit = (list || []).find(g => g && normText(g.text) === text)
    if (!hit) continue
    if (hit.since) return hit.since < since ? hit.since : since
    since = d
    if (!String(hit.id || '').startsWith('ro:')) break // reached the day it was created
  }
  return since
}

// Past day lists, oldest first, as [date, list] pairs.
function pastHistory(activeDate) {
  return storeListKeys('goals:')
    .map(k => k.slice(6))
    .filter(d => d < activeDate)
    .sort()
    .map(d => [d, storeGet('goals:' + d) || []])
}

export function doRollover() {
  const activeDate = getActiveDateString()
  const todayKey = 'goals:' + activeDate

  const stored = storeGet(ROLLOVER_DONE_KEY)
  const done = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {}

  // One-time catch-up for data that predates this record. Rollover ran on every launch,
  // so any past day still sitting here has already been carried forward — many times
  // over, which is precisely the bug. Mark them retired WITHOUT rolling them again,
  // otherwise every task you have already deleted returns one last time.
  if (stored === null) {
    storeListKeys('goals:').forEach(key => {
      const dateStr = key.slice(6)
      if (dateStr < activeDate) done[dateStr] = Date.now()
    })
    storeSetSilent(ROLLOVER_DONE_KEY, done)
    return
  }
  // Tasks you deleted from today must not be re-added by a second rollover pass on the
  // same day (a reload, or a second tab, before the retired-day record has synced).
  const deletedToday = getItemTombs()[todayKey] || {}

  const history = pastHistory(activeDate)
  const unretired = history.filter(([d]) => !done[d])

  let todayGoals = storeGet(todayKey) || []
  const existingTexts = new Set(todayGoals.map(g => g.text))
  let todayChanged = false

  // Carry from the most recent unretired day only.
  const source = unretired[unretired.length - 1]
  if (source) {
    const [sourceDay, goals] = source
    goals.filter(g => g && !g.done).forEach(g => {
      if (existingTexts.has(g.text)) return
      const since = taskSince(g, sourceDay, history)
      if (daysBetween(since, activeDate) > CARRY_MAX_DAYS) return // stays in history
      const id = rolloverId(activeDate, g.text)
      if (deletedToday[id]) return // you already deleted this one today
      todayGoals.push({ id, text: g.text, done: false, since })
      existingTexts.add(g.text)
      todayChanged = true
    })
  }

  // Retire every unretired day, carried from or not.
  unretired.forEach(([d]) => { done[d] = Date.now() })

  if (todayChanged) storeSetSilent(todayKey, todayGoals)
  if (unretired.length) storeSetSilent(ROLLOVER_DONE_KEY, done)

  pruneStaleCarried(activeDate, history)
}

// One-time cleanup for lists the old rule already filled: drop tasks the previous
// rollover carried into today (`ro:<today>:` ids, no `since`) that were first planned
// more than CARRY_MAX_DAYS ago. They remain on the earlier days they were planned for.
// Only those rows are touched — anything you added or moved into today keeps its own id
// and is never removed. The silent write still records each removal as a deletion, so
// other devices drop them too instead of pushing them back.
function pruneStaleCarried(activeDate, history) {
  const todayKey = 'goals:' + activeDate
  const today = storeGet(todayKey)
  if (!Array.isArray(today) || !today.length) return
  const prefix = `ro:${activeDate}:`
  const kept = today.filter(g => {
    if (!g || g.done || g.since || !String(g.id || '').startsWith(prefix)) return true
    return daysBetween(taskSince(g, activeDate, history), activeDate) <= CARRY_MAX_DAYS
  })
  if (kept.length !== today.length) storeSetSilent(todayKey, kept)
}

export function injectRecurringTasks() {
  const recurring = storeGet('recurring_tasks') || []
  if (!recurring.length) return
  const activeDate = getActiveDateString()
  const [y, m, d] = activeDate.split('-').map(Number)
  const activeDay = new Date(y, m - 1, d)
  const dayOfWeek = activeDay.getDay()
  const dayOfMonth = activeDay.getDate()
  const todayGoals = storeGet('goals:' + activeDate) || []
  const existingTexts = new Set(todayGoals.map(g => g.text))
  let changed = false
  recurring.forEach(task => {
    if (existingTexts.has(task.text)) return
    let applies = false
    if (task.freq === 'daily') applies = true
    else if (task.freq === 'weekly') applies = (task.days || []).includes(dayOfWeek)
    else if (task.freq === 'monthly') applies = (task.days || []).includes(dayOfMonth)
    if (applies) {
      todayGoals.push({ id: recurringId(activeDate, task.text), text: task.text, done: false })
      existingTexts.add(task.text)
      changed = true
    }
  })
  if (changed) storeSetSilent('goals:' + activeDate, todayGoals)
}
