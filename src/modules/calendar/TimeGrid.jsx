import { useState, useRef, useEffect, useCallback } from 'react'
import MiniMonth from './MiniMonth.jsx'
import {
  HOUR_HEIGHT, HOURS, TAG_STYLES,
  isSameDay, getWeekDays, formatHour, formatTimeRange,
  isSleepHour, minutesFromMidnight, getDayEvents, hasGymOnDay,
} from './calendarUtils.js'

export default function TimeGrid({
  view,
  currentDate,
  events,
  gymPlanned,
  showMiniMonth,
  onToggleMiniMonth,
  onDateSelect,
  onCreateEvent,
  onEventClick,
  onSkipGymWorkout,
}) {
  const days = view === 'week' ? getWeekDays(currentDate) : [currentDate]
  const scrollRef = useRef(null)
  const [now, setNow] = useState(new Date())
  const dragRef = useRef(null)
  const [dragState, setDragState] = useState(null)
  const today = new Date()

  // Scroll to current time on mount / view change
  useEffect(() => {
    if (scrollRef.current) {
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes()
      scrollRef.current.scrollTop = Math.max(0, (nowMins / 60) * HOUR_HEIGHT - 200)
    }
  }, [view])

  // Update clock every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  const nowMins = now.getHours() * 60 + now.getMinutes()
  const nowTop  = (nowMins / 60) * HOUR_HEIGHT
  const todayIdx = days.findIndex(d => isSameDay(d, today))

  const eventsPerDay = days.map(day => getDayEvents(day, events, gymPlanned))
  const allDayEventsPerDay = eventsPerDay.map(dayEvs => dayEvs.filter(e => e.is_all_day))
  const timedEventsPerDay  = eventsPerDay.map(dayEvs => dayEvs.filter(e => !e.is_all_day))

  const hasAnyAllDay = allDayEventsPerDay.some(d => d.length > 0)

  // Drag-to-create (mouse only — touch is reserved for swipe nav)
  const handleMouseDown = useCallback((di, e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const scrollTop = scrollRef.current?.scrollTop || 0
    const y = e.clientY - rect.top + scrollTop
    const slot = Math.max(0, Math.min(23, Math.floor(y / HOUR_HEIGHT)))
    dragRef.current = { dayIndex: di, startSlot: slot, endSlot: slot + 1 }
    setDragState({ dayIndex: di, startSlot: slot, endSlot: slot + 1 })
  }, [])

  const handleMouseMove = useCallback((di, e) => {
    if (!dragRef.current || dragRef.current.dayIndex !== di) return
    const rect = e.currentTarget.getBoundingClientRect()
    const scrollTop = scrollRef.current?.scrollTop || 0
    const y = e.clientY - rect.top + scrollTop
    const slot = Math.max(0, Math.min(23, Math.floor(y / HOUR_HEIGHT)))
    const endSlot = Math.max(slot + 1, dragRef.current.startSlot + 1)
    dragRef.current.endSlot = endSlot
    setDragState({ dayIndex: di, startSlot: dragRef.current.startSlot, endSlot })
  }, [])

  const handleMouseUp = useCallback((di, e) => {
    if (!dragRef.current) return
    const { dayIndex, startSlot, endSlot } = dragRef.current
    dragRef.current = null
    setDragState(null)
    onCreateEvent({ date: days[dayIndex], startHour: startSlot, endHour: endSlot })
  }, [days, onCreateEvent])

  // Global mouseup to end drag even if cursor leaves column
  useEffect(() => {
    const up = () => {
      if (dragRef.current) {
        const { dayIndex, startSlot, endSlot } = dragRef.current
        dragRef.current = null
        setDragState(null)
        onCreateEvent({ date: days[dayIndex], startHour: startSlot, endHour: endSlot })
      }
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [days, onCreateEvent])

  const nowStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  return (
    <div className="cal-timegrid-wrap">
      {/* All-day strip (only shown if there are all-day events) */}
      {hasAnyAllDay && (
        <div className="cal-allday-row">
          <div className="cal-allday-gutter">all‑day</div>
          {days.map((day, di) => (
            <div key={di} className="cal-allday-cell">
              {allDayEventsPerDay[di].map(ev => {
                const s = TAG_STYLES[ev.module_tag] || TAG_STYLES.personal
                return (
                  <div
                    key={ev.id}
                    className="cal-allday-event"
                    style={{ background: s.bg, borderColor: s.border, color: s.color }}
                    onClick={() => onEventClick(ev)}
                  >
                    {ev.title}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Day header row */}
      <div className="cal-day-headers">
        <div className="cal-gutter-label" />
        {days.map((day, di) => {
          const isToday   = isSameDay(day, today)
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          const hasGym    = hasGymOnDay(day, gymPlanned)
          return (
            <div
              key={di}
              className={`cal-day-header-cell${isToday ? ' today' : ''}${isWeekend ? ' weekend' : ''}${hasGym ? ' has-gym' : ''}`}
              onClick={() => onDateSelect(day)}
            >
              <div className="cal-day-dow">
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              <div className={`cal-day-num${isToday ? ' today' : ''}`}>
                {day.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* Scrollable grid */}
      <div className="cal-grid-scroll" ref={scrollRef}>
        <div className="cal-grid-layout" style={{ height: HOUR_HEIGHT * 24 }}>
          {/* Hour gutter */}
          <div className="cal-time-gutter">
            {HOURS.map(h => (
              <div key={h} className="cal-hour-label" style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}>
                {h > 0 ? formatHour(h) : null}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="cal-columns-wrap">
            {days.map((day, di) => {
              const isWeekend = day.getDay() === 0 || day.getDay() === 6
              const isToday   = isSameDay(day, today)
              const dayEvents = timedEventsPerDay[di]

              return (
                <div
                  key={di}
                  className={`cal-day-col${isWeekend ? ' weekend' : ''}${isToday ? ' today' : ''}`}
                  onMouseDown={e => handleMouseDown(di, e)}
                  onMouseMove={e => handleMouseMove(di, e)}
                  onMouseUp={e => handleMouseUp(di, e)}
                >
                  {/* Hour rows — visual grid lines */}
                  {HOURS.map(h => (
                    <div
                      key={h}
                      className={`cal-hour-row${isSleepHour(h) ? ' sleep' : ''}`}
                      style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Events */}
                  {dayEvents.map(ev => {
                    const start    = new Date(ev.start_time)
                    const end      = new Date(ev.end_time)
                    const topPx    = (minutesFromMidnight(start) / 60) * HOUR_HEIGHT
                    const durMins  = Math.max((end - start) / 60000, 30)
                    const heightPx = (durMins / 60) * HOUR_HEIGHT
                    const s        = TAG_STYLES[ev.module_tag] || TAG_STYLES.personal
                    const isTall   = heightPx > 42

                    return (
                      <div
                        key={ev.id}
                        className={`cal-event${ev.is_gym_planned ? ' is-gym' : ''}`}
                        style={{
                          top: topPx + 1,
                          height: heightPx - 2,
                          background: s.bg,
                          borderColor: s.border,
                          color: s.color,
                        }}
                        onClick={e => { e.stopPropagation(); onEventClick(ev) }}
                        title={`${ev.title}\n${formatTimeRange(start, end)}`}
                      >
                        <span className="cal-event-icon">{s.icon}</span>
                        <div className="cal-event-body">
                          <div className="cal-event-title">{ev.title}</div>
                          {isTall && (
                            <div className="cal-event-time">{formatTimeRange(start, end)}</div>
                          )}
                        </div>
                        {ev.is_gym_planned && ev.gym_status !== 'completed' && isTall && (
                          <button
                            className="cal-skip-btn"
                            onClick={e => { e.stopPropagation(); onSkipGymWorkout(ev.gym_planned_id) }}
                          >
                            Skip
                          </button>
                        )}
                      </div>
                    )
                  })}

                  {/* Drag preview */}
                  {dragState?.dayIndex === di && (
                    <div
                      className="cal-drag-preview"
                      style={{
                        top: dragState.startSlot * HOUR_HEIGHT,
                        height: (dragState.endSlot - dragState.startSlot) * HOUR_HEIGHT,
                      }}
                    />
                  )}

                  {/* Now line (in today's column only) */}
                  {isToday && (
                    <div className="cal-now-line" style={{ top: nowTop }}>
                      <span className="cal-now-dot" />
                      <span className="cal-now-time-pill">{nowStr}</span>
                      <div className="cal-now-bar" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

      </div>

      {/* Mini month — positioned absolutely within cal-timegrid-wrap, outside scroll */}
      {showMiniMonth && (
        <div className="cal-mini-month-panel">
          <MiniMonth
            currentDate={currentDate}
            events={events}
            gymPlanned={gymPlanned}
            onSelect={onDateSelect}
          />
        </div>
      )}
      <button
        className="cal-mini-toggle-btn"
        onClick={onToggleMiniMonth}
        title={showMiniMonth ? 'Hide calendar' : 'Show mini calendar'}
      >
        {showMiniMonth ? '◀' : '▶'}
      </button>
    </div>
  )
}
