import { useState, useEffect, useCallback } from 'react'
import { storeGet, storeSet } from '../../lib/storage.js'
import TimeGrid from './TimeGrid.jsx'
import MonthView from './MonthView.jsx'
import EventModal from './EventModal.jsx'
import { getWeekDays, formatMonthYear, isSameDay } from './calendarUtils.js'

const STORAGE_KEY = 'calendar_events'

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
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function Calendar() {
  const [view, setView] = useState('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [events, setEvents] = useState([])
  const [gymPlanned, setGymPlanned] = useState([])
  const [showMiniMonth, setShowMiniMonth] = useState(true)
  const [showEventModal, setShowEventModal] = useState(false)
  const [editEvent, setEditEvent] = useState(null)
  const [defaultSlot, setDefaultSlot] = useState(null)

  // Load data from localStorage
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

  const handleCreateEvent = useCallback((slot) => {
    setDefaultSlot(slot)
    setEditEvent(null)
    setShowEventModal(true)
  }, [])

  const handleEventClick = useCallback((ev) => {
    if (ev.is_gym_planned) return
    setEditEvent(ev)
    setDefaultSlot(null)
    setShowEventModal(true)
  }, [])

  const handleEventSave = useCallback((data) => {
    if (editEvent) {
      saveEvents(events.map(e => e.id === editEvent.id ? { ...e, ...data } : e))
    } else {
      saveEvents([...events, { id: crypto.randomUUID(), user_id: 'dane', ...data, created_at: new Date().toISOString() }])
    }
    setShowEventModal(false)
  }, [editEvent, events, saveEvents])

  const handleEventDelete = useCallback((id) => {
    saveEvents(events.filter(e => e.id !== id))
    setShowEventModal(false)
  }, [events, saveEvents])

  const handleSkipGymWorkout = useCallback((gymPlannedId) => {
    const updated = gymPlanned.map(g => g.id === gymPlannedId ? { ...g, status: 'skipped' } : g)
    storeSet('gym_planned', updated)
    setGymPlanned(updated)
  }, [gymPlanned])

  const navigate = useCallback((dir) => {
    setCurrentDate(prev => {
      const d = new Date(prev)
      if (view === 'day')   d.setDate(d.getDate() + dir)
      else if (view === 'week') d.setDate(d.getDate() + dir * 7)
      else d.setMonth(d.getMonth() + dir)
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
            onClick={() => { setDefaultSlot(null); setEditEvent(null); setShowEventModal(true) }}
          >
            + New
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="cal-body-wrap">
        {/* Sidebar: mini month (week/day views only, desktop) */}
        {(view === 'week' || view === 'day') && showMiniMonth && (
          <div className="cal-sidebar" />
          // Mini month is rendered inside TimeGrid as an overlay for better positioning
        )}

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

      {showEventModal && (
        <EventModal
          event={editEvent}
          defaultSlot={defaultSlot}
          currentDate={currentDate}
          onSave={handleEventSave}
          onDelete={handleEventDelete}
          onClose={() => setShowEventModal(false)}
        />
      )}
    </div>
  )
}
