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
// Carry yesterday's unfinished tasks into today — ONCE per day, permanently.
//
// This used to delete each past day after rolling it, without recording the deletion.
// The server kept its copy, the next pull put it back, and the next launch rolled it
// again — so a task you deleted returned on every single reload, forever. Deleting it
// harder could not help: the source day was being resurrected from the server each time.
//
// The fix is to remember which days have been retired instead of trying to erase them.
// The record syncs, so a day is rolled once across all your devices, and past days stay
// intact as history (the weekly review reads them).
// ---------------------------------------------------------------------------
export const ROLLOVER_DONE_KEY = 'rollover_done_v1'

export function doRollover() {
  const activeDate = getActiveDateString()
  const todayKey = 'goals:' + activeDate

  const done = storeGet(ROLLOVER_DONE_KEY) || {}
  // Tasks you deleted from today must not be re-added by a second rollover pass on the
  // same day (a reload, or a second tab, before the retired-day record has synced).
  const deletedToday = getItemTombs()[todayKey] || {}

  let todayGoals = storeGet(todayKey) || []
  const existingTexts = new Set(todayGoals.map(g => g.text))
  let todayChanged = false
  let doneChanged = false

  storeListKeys('goals:').sort().forEach(key => {
    const dateStr = key.slice(6)
    if (dateStr >= activeDate) return
    if (done[dateStr]) return // already retired — never roll it a second time

    const goals = storeGet(key) || []
    goals.filter(g => !g.done).forEach(g => {
      if (existingTexts.has(g.text)) return
      const id = rolloverId(activeDate, g.text)
      if (deletedToday[id]) return // you already deleted this one today
      todayGoals.push({ id, text: g.text, done: false })
      existingTexts.add(g.text)
      todayChanged = true
    })

    done[dateStr] = Date.now()
    doneChanged = true
  })

  if (todayChanged) storeSetSilent(todayKey, todayGoals)
  if (doneChanged) storeSetSilent(ROLLOVER_DONE_KEY, done)
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
