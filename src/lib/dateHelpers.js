function localDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getActiveDateString() {
  const now = new Date()
  const d = new Date(now)
  if (now.getHours() < 4) d.setDate(d.getDate() - 1)
  return localDateStr(d)
}

export function getTomorrowDateString() {
  const now = new Date()
  const d = new Date(now)
  if (now.getHours() >= 4) d.setDate(d.getDate() + 1)
  return localDateStr(d)
}

export function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function getActiveWeekKey() {
  const dateStr = getActiveDateString()
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const day = date.getDay() || 7
  const thursday = new Date(y, m - 1, d + (4 - day))
  const jan1 = new Date(thursday.getFullYear(), 0, 1)
  const week = Math.ceil(((thursday - jan1) / 86400000 + 1) / 7)
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`
}
