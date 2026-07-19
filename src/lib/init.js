import { storeGet, storeSet, storeDelete, storeListKeys } from './storage.js'
import { getActiveDateString, getTomorrowDateString } from './dateHelpers.js'

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
          todayGoals.push({ id: crypto.randomUUID(), text: g.text, done: false })
          existingTexts.add(g.text)
        }
      })
      localStorage.setItem(todayKey, JSON.stringify(todayGoals))
    }
    storeDelete(key)
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
      todayGoals.push({ text: task.text, done: false })
      existingTexts.add(task.text)
      changed = true
    }
  })
  if (changed) localStorage.setItem('goals:' + activeDate, JSON.stringify(todayGoals))
}
