import { storeGet, storeSetSilent, storeDeleteSilent, storeListKeys } from './storage.js'
import { getActiveDateString, getTomorrowDateString } from './dateHelpers.js'

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

export function doRollover() {
  const activeDate = getActiveDateString()
  const allKeys = storeListKeys('goals:')
  allKeys.forEach(key => {
    const dateStr = key.slice(6)
    if (dateStr >= activeDate) return
    const goals = storeGet(key) || []
    const undone = goals.filter(g => !g.done)
    if (undone.length > 0) {
      const todayKey = 'goals:' + activeDate
      const todayGoals = storeGet(todayKey) || []
      const existingTexts = new Set(todayGoals.map(g => g.text))
      undone.forEach(g => {
        if (!existingTexts.has(g.text)) {
          todayGoals.push({ id: rolloverId(activeDate, g.text), text: g.text, done: false })
          existingTexts.add(g.text)
        }
      })
      storeSetSilent(todayKey, todayGoals)
    }
    // Silent: retiring a past day is local pruning. A tombstoning delete would push the
    // pruning to every device and destroy shared history.
    storeDeleteSilent(key)
  })
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
