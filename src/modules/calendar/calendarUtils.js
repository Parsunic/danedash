export const HOUR_HEIGHT = 60 // px per hour
export const HOURS = Array.from({ length: 24 }, (_, i) => i)
export const MODULE_TAGS = ['gym', 'school', 'finance', 'personal', 'task']

export const TAG_STYLES = {
  gym:      { bg: 'rgba(232,160,32,0.14)',  border: 'rgba(232,160,32,0.45)', color: '#E8A020', icon: '🏋️' },
  school:   { bg: 'rgba(99,149,242,0.14)', border: 'rgba(99,149,242,0.45)', color: '#6395F2', icon: '📚' },
  finance:  { bg: 'rgba(107,227,164,0.14)',border: 'rgba(107,227,164,0.45)',color: '#6BE3A4', icon: '💰' },
  personal: { bg: 'rgba(255,255,255,0.07)',border: 'rgba(255,255,255,0.2)', color: '#D8D6D0', icon: '👤' },
  task:     { bg: 'rgba(255,255,255,0.04)',border: 'rgba(255,255,255,0.12)',color: '#76746E', icon: '✓'  },
}

export const CATEGORIES = [
  { label: 'Routine',        hex: '#E03131' },
  { label: 'Personal',       hex: '#E8590C' },
  { label: 'Transportation', hex: '#F59F00' },
  { label: 'Hygiene',        hex: '#2F9E44' },
  { label: 'Work',           hex: '#1971C2' },
  { label: 'School',         hex: '#7048E8' },
  { label: 'Other',          hex: '#868E96' },
]
export const DEFAULT_CATEGORY_HEX = '#868E96'

export function snapToTen(mins) {
  return Math.round(mins / 10) * 10
}

export function roundUpToTen(mins) {
  return Math.ceil(mins / 10) * 10
}

export function minsToTimeStr(totalMins) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMins))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function hexToEventStyle(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return {
    bg: `rgba(${r},${g},${b},0.13)`,
    border: `rgba(${r},${g},${b},0.55)`,
    color: hex,
    icon: null,
  }
}

export function getEventStyle(ev) {
  if (ev.color) return hexToEventStyle(ev.color)
  return TAG_STYLES[ev.module_tag] || TAG_STYLES.personal
}

export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function startOfWeek(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

export function getWeekDays(date) {
  const start = startOfWeek(date)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d
  })
}

export function formatMonthYear(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function formatHour(h) {
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export function formatTimeRange(start, end) {
  const fmt = (d) => {
    const dt = new Date(d)
    const h = dt.getHours(), m = dt.getMinutes()
    const ap = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`
  }
  return `${fmt(start)} – ${fmt(end)}`
}

export function minutesFromMidnight(date) {
  const d = new Date(date)
  return d.getHours() * 60 + d.getMinutes()
}

export function isSleepHour(h) {
  return h >= 23 || h < 7
}

export function toDateStr(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function toTimeStr(hour, minute = 0) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function expandRecurring(event, windowStart, windowEnd) {
  if (!event.recurrence_rule) return [event]
  const results = []
  const base = new Date(event.start_time)
  const endT = new Date(event.end_time)
  const duration = endT - base
  let cur = new Date(base)
  let iters = 0
  while (cur <= windowEnd && iters < 500) {
    iters++
    if (cur >= windowStart) {
      results.push({
        ...event,
        id: `${event.id}_r${iters}`,
        start_time: new Date(cur),
        end_time: new Date(cur.getTime() + duration),
        _base_id: event.id,
      })
    }
    if (event.recurrence_rule === 'daily') cur.setDate(cur.getDate() + 1)
    else if (event.recurrence_rule === 'weekly') cur.setDate(cur.getDate() + 7)
    else if (event.recurrence_rule === 'monthly') cur.setMonth(cur.getMonth() + 1)
    else break
  }
  return results
}

export function gymPlannedToEvent(gp, date) {
  const d = new Date(date)
  return {
    id: `gym_${gp.id}`,
    title: gp.name,
    start_time: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 0),
    end_time:   new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 30),
    module_tag: 'gym',
    is_gym_planned: true,
    gym_planned_id: gp.id,
    gym_status: gp.status,
  }
}

export function getDayEvents(date, calEvents, gymPlanned) {
  const ws = new Date(date); ws.setHours(0, 0, 0, 0)
  const we = new Date(date); we.setHours(23, 59, 59, 999)
  const results = []

  for (const ev of calEvents) {
    const expanded = expandRecurring(ev, ws, we)
    for (const e of expanded) {
      if (isSameDay(new Date(e.start_time), date)) results.push(e)
    }
  }

  for (const gp of gymPlanned) {
    if (gp.status === 'skipped') continue
    const gpDate = new Date(gp.date + 'T00:00:00')
    if (isSameDay(gpDate, date)) {
      results.push(gymPlannedToEvent(gp, date))
    }
  }

  return results
}

export function getBusyScore(date, calEvents, gymPlanned) {
  const evs = getDayEvents(date, calEvents, gymPlanned)
  let mins = 0
  for (const ev of evs) {
    if (!ev.is_all_day) {
      const s = new Date(ev.start_time), e = new Date(ev.end_time)
      mins += Math.max(0, (e - s) / 60000)
    }
  }
  return Math.min(mins / (8 * 60), 1)
}

export function getMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const grid = []
  let week = []

  const startPad = first.getDay()
  for (let i = 0; i < startPad; i++) {
    week.push({ date: new Date(year, month, 1 - startPad + i), inMonth: false })
  }

  for (let d = 1; d <= last.getDate(); d++) {
    week.push({ date: new Date(year, month, d), inMonth: true })
    if (week.length === 7) { grid.push(week); week = [] }
  }

  if (week.length > 0) {
    let d = 1
    while (week.length < 7) {
      week.push({ date: new Date(year, month + 1, d++), inMonth: false })
    }
    grid.push(week)
  }

  return grid
}

export function hasGymOnDay(date, gymPlanned) {
  return gymPlanned.some(
    gp => gp.status !== 'skipped' && isSameDay(new Date(gp.date + 'T00:00:00'), date)
  )
}
