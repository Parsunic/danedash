import { getMonthGrid, isSameDay, getDayEvents, getEventStyle, hasGymOnDay } from './calendarUtils.js'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_CHIPS = 3

function dk(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function reviewDotColor(score) {
  if (score >= 70) return 'var(--success)'
  if (score >= 40) return 'var(--warning)'
  return 'var(--danger)'
}

export default function MonthView({ currentDate, events, gymPlanned, dayReviews = [], onDateSelect, onEventClick }) {
  const today = new Date()
  const grid = getMonthGrid(currentDate.getFullYear(), currentDate.getMonth())
  const reviewMap = Object.fromEntries(dayReviews.map(r => [r.date, r.overall_adherence_score]))

  return (
    <div className="cal-month-view">
      <div className="cal-month-dow-row">
        {DOW.map(d => (
          <div key={d} className="cal-month-dow">{d}</div>
        ))}
      </div>
      <div className="cal-month-grid">
        {grid.map((week, wi) => (
          <div key={wi} className="cal-month-week-row">
            {week.map(({ date, inMonth }, di) => {
              const isToday  = isSameDay(date, today)
              const isSelected = isSameDay(date, currentDate)
              const hasGym   = inMonth && hasGymOnDay(date, gymPlanned)
              const dayEvs   = inMonth ? getDayEvents(date, events, gymPlanned) : []
              const visible  = dayEvs.slice(0, MAX_CHIPS)
              const overflow = dayEvs.length - MAX_CHIPS

              return (
                <div
                  key={di}
                  className={`cal-month-cell${!inMonth ? ' out-of-month' : ''}${isToday ? ' today' : ''}${hasGym ? ' has-gym' : ''}${isSelected && !isToday ? ' selected' : ''}`}
                  onClick={() => onDateSelect(date)}
                >
                  <div className={`cal-month-date${isToday ? ' today' : ''}`}>
                    {date.getDate()}
                  </div>
                  {visible.map(ev => {
                    const s = getEventStyle(ev)
                    return (
                      <div
                        key={ev.id}
                        className="cal-month-event-chip"
                        style={{ background: s.bg, borderColor: s.border, color: s.color }}
                        onClick={e => { e.stopPropagation(); onEventClick(ev) }}
                        title={ev.title}
                      >
                        {s.icon ? `${s.icon} ` : ''}{ev.title}
                      </div>
                    )
                  })}
                  {overflow > 0 && (
                    <div className="cal-month-more">+{overflow} more</div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
