export const JOURNAL_KEY = 'journal_entries'

export const TAGS = ['daily', 'regroup', 'important']

export const PROMPTS = [
  "Where is this going? What's working? What's failing? What's next?",
  "What would make today a win?",
  "What are you avoiding?",
  "What did you do today that your future self will thank you for?",
  "What's one thing you're proud of today, however small?",
  "What surprised you today?",
  "What conversation have you been putting off?",
]

// 5 models for prompt variety
export const AI_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
]

// Days reset at 5 AM
export function getJournalDateString() {
  const now = new Date()
  if (now.getHours() < 5) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
}

// Rotate prompt by day-of-year so each day gets the same prompt
export function getDailyPrompt(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const start = new Date(d.getFullYear(), 0, 0)
  const dayOfYear = Math.round((d - start) / 86400000)
  return PROMPTS[dayOfYear % PROMPTS.length]
}

export function isEntryLocked(entry) {
  return Date.now() - new Date(entry.created_at).getTime() < 24 * 60 * 60 * 1000
}

export function lockTimeRemaining(entry) {
  const ms = 24 * 60 * 60 * 1000 - (Date.now() - new Date(entry.created_at).getTime())
  if (ms <= 0) return ''
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function calcStreak(entries, todayStr) {
  const days = new Set(entries.map(e => e.date))
  let streak = 0
  const cur = new Date(todayStr + 'T12:00:00')
  while (true) {
    const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`
    if (days.has(ds)) {
      streak++
      cur.setDate(cur.getDate() - 1)
    } else break
  }
  return streak
}

export function getMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const grid = []
  let week = []
  const pad = first.getDay()
  for (let i = 0; i < pad; i++) week.push({ date: new Date(year, month, 1 - pad + i), inMonth: false })
  for (let d = 1; d <= last.getDate(); d++) {
    week.push({ date: new Date(year, month, d), inMonth: true })
    if (week.length === 7) { grid.push(week); week = [] }
  }
  if (week.length > 0) {
    let d = 1
    while (week.length < 7) week.push({ date: new Date(year, month + 1, d++), inMonth: false })
    grid.push(week)
  }
  return grid
}

export function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
