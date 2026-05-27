import { useState, useEffect, useCallback } from 'react'
import { storeGet, storeSet } from '../../lib/storage.js'
import TimeGrid from './TimeGrid.jsx'
import MonthView from './MonthView.jsx'
import EventSidebar from './EventSidebar.jsx'
import { getWeekDays, formatMonthYear } from './calendarUtils.js'

const STORAGE_KEY = 'calendar_events'

function dayDiff(date) {
  const today = new Date()
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((a - b) / 86400000)
}

function ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function headerLabel(view, date) {
  if (view === 'month') return formatMonthYear(date)
  if (view === 'week') {
    const days = getWeekDays(date)
    const start = days[0], end = days[6]
    if (start.getMonth() === end.getMonth()) {
      return `${start.toLocaleDateString('en-US', { month: 'long' })} ${start.getFullYear()}`
    }
    return `${start.toLocaleDateString('en-US', { month: 'short' })} – ${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
  }
  const diff = dayDiff(date)
  if (diff === 0) return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff === 1) return 'Tomorrow'
  if (diff > 1 && diff <= 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
  return `${date.toLocaleDateString('en-US', { month: 'long' })} ${ordinalSuffix(date.getDate())}`
}

export default function Calendar() {
  const [view, setView] = useState('day')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [events, setEvents] = useState([])
  const [gymPlanned, setGymPlanned] = useState([])
  const [showMiniMonth, setShowMiniMonth] = useState(true)
  const [showSidebar, setShowSidebar] = useState(false)
  const [editEvent, setEditEvent] = useState(null)
  const [defaultSlot, setDefaultSlot] = useState(null)

  useEffect(() => {
    setEvents(storeGet(STORAGE_KEY) || [])
    setGymPlanned(storeGet('gym_planned') || [])

    const refresh = () => {
      setEvents(storeGet(STORAGE_KEY) || [])
      setGymPlanned(storeGet('gym_planned') || [])
    }
    window.addEventListener('gym-changed', refresh)
    window.addEventListener('schedule-sync', refresh)
    return () => {
      window.removeEventListener('gym-changed', refresh)
      window.removeEventListener('schedule-sync', refresh)
    }
  }, [])

  const saveEvents = useCallback((next) => {
    storeSet(STORAGE_KEY, next)
    setEvents(next)
  }, [])

  // Called from TimeGrid drag-to-create — receives { date, startMin, endMin }
  const handleCreateEvent = useCallback((slot) => {
    setDefaultSlot(slot)
    setEditEvent(null)
    setShowSidebar(true)
  }, [])

  const handleEventClick = useCallback((ev) => {
    if (ev.is_gym_planned) return
    setEditEvent(ev)
    setDefaultSlot(null)
    setShowSidebar(true)
  }, [])

  const handleEventSave = useCallback((data) => {
    if (editEvent) {
      saveEvents(events.map(e => e.id === editEvent.id ? { ...e, ...data } : e))
    } else {
      saveEvents([...events, { id: crypto.randomUUID(), user_id: 'dane', ...data, created_at: new Date().toISOString() }])
    }
    setShowSidebar(false)
  }, [editEvent, events, saveEvents])

  const handleEventDelete = useCallback((id) => {
    saveEvents(events.filter(e => e.id !== id))
    setShowSidebar(false)
  }, [events, saveEvents])

  // Called from TimeGrid move/resize drag — direct time update, no sidebar
  const handleEventUpdate = useCallback((eventId, startIso, endIso) => {
    saveEvents(events.map(e => e.id === eventId ? { ...e, start_time: startIso, end_time: endIso } : e))
  }, [events, saveEvents])

  const handleSkipGymWorkout = useCallback((gymPlannedId) => {
    const updated = gymPlanned.map(g => g.id === gymPlannedId ? { ...g, status: 'skipped' } : g)
    storeSet('gym_planned', updated)
    setGymPlanned(updated)
  }, [gymPlanned])

  const navigate = useCallback((dir) => {
    setCurrentDate(prev => {
      const d = new Date(prev)
      if (view === 'day')        d.setDate(d.getDate() + dir)
      else if (view === 'week')  d.setDate(d.getDate() + dir * 7)
      else                       d.setMonth(d.getMonth() + dir)
      return d
    })
  }, [view])

  const handleDateSelect = useCallback((date) => {
    setCurrentDate(date)
    if (view === 'month') setView('day')
  }, [view])

  return (
    <div className="cal-root">
      {/* Header */}
      <div className="cal-header">
        <div className="cal-header-left">
          <h1 className="dash-title" style={{ marginBottom: 0 }}>Calendar</h1>
          <div className="cal-header-sub">{headerLabel(view, currentDate)}</div>
        </div>
        <div className="cal-header-controls">
          <div className="cal-view-switcher">
            {['day', 'week', 'month'].map(v => (
              <button
                key={v}
                className={`cal-view-btn${view === v ? ' active' : ''}`}
                onClick={() => setView(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="cal-nav-group">
            <button className="cal-nav-btn" onClick={() => navigate(-1)}>‹</button>
            <button className="cal-today-btn" onClick={() => setCurrentDate(new Date())}>Today</button>
            <button className="cal-nav-btn" onClick={() => navigate(1)}>›</button>
          </div>
          <button
            className="cal-add-btn"
            onClick={() => { setDefaultSlot(null); setEditEvent(null); setShowSidebar(true) }}
          >
            + New
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="cal-body-wrap">
        <div className="cal-main">
          {(view === 'week' || view === 'day') && (
            <TimeGrid
              view={view}
              currentDate={currentDate}
              events={events}
              gymPlanned={gymPlanned}
              showMiniMonth={showMiniMonth}
              onToggleMiniMonth={() => setShowMiniMonth(v => !v)}
              onDateSelect={handleDateSelect}
              onCreateEvent={handleCreateEvent}
              onEventClick={handleEventClick}
              onEventUpdate={handleEventUpdate}
              onSkipGymWorkout={handleSkipGymWorkout}
            />
          )}
          {view === 'month' && (
            <MonthView
              currentDate={currentDate}
              events={events}
              gymPlanned={gymPlanned}
              onDateSelect={handleDateSelect}
              onEventClick={handleEventClick}
            />
          )}
        </div>
      </div>

      {showSidebar && (
        <EventSidebar
          event={editEvent}
          defaultSlot={defaultSlot}
          currentDate={currentDate}
          events={events}
          onSave={handleEventSave}
          onDelete={handleEventDelete}
          onClose={() => setShowSidebar(false)}
        />
      )}
    </div>
  )
}
