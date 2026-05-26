import { getMonthGrid, isSameDay, getDayEvents, TAG_STYLES, hasGymOnDay } from './calendarUtils.js'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_CHIPS = 3

export default function MonthView({ currentDate, events, gymPlanned, onDateSelect, onEventClick }) {
  const today = new Date()
  const grid = getMonthGrid(currentDate.getFullYear(), currentDate.getMonth())

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
                    const s = TAG_STYLES[ev.module_tag] || TAG_STYLES.personal
                    return (
                      <div
                        key={ev.id}
                        className="cal-month-event-chip"
                        style={{ background: s.bg, borderColor: s.border, color: s.color }}
                        onClick={e => { e.stopPropagation(); onEventClick(ev) }}
                        title={ev.title}
                      >
                        {s.icon} {ev.title}
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
