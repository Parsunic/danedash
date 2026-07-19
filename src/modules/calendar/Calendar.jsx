import { useState, useEffect, useCallback, useRef } from 'react'
import { storeGet, storeSet } from '../../lib/storage.js'
import { getActiveDateString } from '../../lib/dateHelpers.js'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import TimeGrid from './TimeGrid.jsx'
import UnscheduledShelf from './UnscheduledShelf.jsx'
import MonthView from './MonthView.jsx'
import EventSidebar from './EventSidebar.jsx'
import AIPlannerPanel from './AIPlannerPanel.jsx'
import DayReviewPanel from './DayReviewPanel.jsx'
import { getWeekDays, formatMonthYear } from './calendarUtils.js'
import { syncEventCreate, syncEventUpdate, syncEventDelete } from './googleSync.js'
import { isConnected } from '../../lib/api/gcalendar.js'
import { supabase } from '../../lib/supabase.js'

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
  const [currentDate, setCurrentDate] = useState(() => {
    const [y, m, d] = getActiveDateString().split('-').map(Number)
    return new Date(y, m - 1, d)
  })
  const [events, setEvents] = useState([])
  const [gymPlanned, setGymPlanned] = useState([])
  const [showMiniMonth, setShowMiniMonth] = useState(true)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showAIPlanner, setShowAIPlanner] = useState(false)
  const [showDayReview, setShowDayReview] = useState(false)
  const [dayReviews, setDayReviews] = useState([])
  const [editEvent, setEditEvent] = useState(null)
  const [defaultSlot, setDefaultSlot] = useState(null)
  const [gcalConnected, setGcalConnected] = useState(() => isConnected())
  const eventsRef = useRef([])

  useEffect(() => {
    setEvents(storeGet(STORAGE_KEY) || [])
    setGymPlanned(storeGet('gym_planned') || [])

    const refresh = () => {
      setEvents(storeGet(STORAGE_KEY) || [])
      setGymPlanned(storeGet('gym_planned') || [])
    }
    const refreshEvents = () => setEvents(storeGet(STORAGE_KEY) || [])
    const onDisconnect = () => setGcalConnected(false)
    window.addEventListener('gym-changed', refresh)
    window.addEventListener('schedule-sync', refresh)
    window.addEventListener('calendar-gcal-synced', refreshEvents)
    window.addEventListener('gcal-disconnected', onDisconnect)
    return () => {
      window.removeEventListener('gym-changed', refresh)
      window.removeEventListener('schedule-sync', refresh)
      window.removeEventListener('calendar-gcal-synced', refreshEvents)
      window.removeEventListener('gcal-disconnected', onDisconnect)
    }
  }, [])

  const fetchDayReviews = useCallback(async () => {
    const { data } = await supabase
      .from('day_reviews')
      .select('date, overall_adherence_score')
    setDayReviews(data || [])
  }, [])

  useEffect(() => {
    fetchDayReviews()
    const onSaved = () => fetchDayReviews()
    window.addEventListener('day-review-saved', onSaved)
    return () => window.removeEventListener('day-review-saved', onSaved)
  }, [fetchDayReviews])

  const saveEvents = useCallback((next) => {
    eventsRef.current = next
    storeSet(STORAGE_KEY, next)
    setEvents(next)
  }, [])

  // Keep eventsRef in sync when state is updated externally (Supabase/GCal sync)
  useEffect(() => { eventsRef.current = events }, [events])

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
    const current = eventsRef.current
    if (editEvent) {
      // Find the latest version of the event (may have gained googleEventId since sidebar opened)
      const latest = current.find(e => e.id === editEvent.id) || editEvent
      const updatedEvent = { ...latest, ...data }
      saveEvents(current.map(e => e.id === editEvent.id ? updatedEvent : e))
      syncEventUpdate(updatedEvent)
    } else {
      const newEvt = { id: crypto.randomUUID(), user_id: 'dane', ...data, created_at: new Date().toISOString() }
      // Deduplicate by id as a failsafe
      const existingIds = new Set(current.map(e => e.id))
      if (!existingIds.has(newEvt.id)) {
        saveEvents([...current, newEvt])
        syncEventCreate(newEvt)
      }
    }
    setShowSidebar(false)
  }, [editEvent, saveEvents])

  const handleEventDelete = useCallback((id) => {
    syncEventDelete(id)
    saveEvents(eventsRef.current.filter(e => e.id !== id))
    setShowSidebar(false)
  }, [saveEvents])

  const handleAIEventsAdd = useCallback((newEvents) => {
    const current = eventsRef.current
    const existingIds = new Set(current.map(e => e.id))
    const deduped = newEvents.filter(e => !existingIds.has(e.id))
    saveEvents([...current, ...deduped])
    deduped.forEach(ev => syncEventCreate(ev))
  }, [saveEvents])

  // ── F5 Timeboxing: armed shelf chip (mobile tap-tap placement mode) ──
  const [armedTask, setArmedTask] = useState(null)

  useEffect(() => {
    if (!armedTask) return
    const onKey = (e) => { if (e.key === 'Escape') setArmedTask(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [armedTask])

  // Called from TimeGrid (chip drop or armed tap) — creates a 45-min task
  // event at the snapped slot through the normal creation path (sync included).
  const handleTimeboxPlace = useCallback((date, startMin, task) => {
    if (!date || !task || !task.goalId) return
    const m = Math.max(0, Math.min(24 * 60 - 45, startMin))
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(m / 60), m % 60)
    const end = new Date(start.getTime() + 45 * 60000)
    handleAIEventsAdd([{
      id: crypto.randomUUID(),
      user_id: 'dane',
      title: task.title,
      description: '',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      is_all_day: false,
      module_tag: 'task',
      source_goal_id: task.goalId,
      created_at: new Date().toISOString(),
    }])
    setArmedTask(null)
  }, [handleAIEventsAdd])

  // Called from TimeGrid move/resize drag — direct time update, no sidebar
  const handleEventUpdate = useCallback((eventId, startIso, endIso) => {
    const current = eventsRef.current
    const updatedEvents = current.map(e => e.id === eventId ? { ...e, start_time: startIso, end_time: endIso } : e)
    saveEvents(updatedEvents)
    const updated = updatedEvents.find(e => e.id === eventId)
    if (updated) syncEventUpdate(updated)
  }, [saveEvents])

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
      <BackgroundBlob page="calendar" />
      {!gcalConnected && (
        <div
          className="gcal-connect-banner"
          onClick={() => window.dispatchEvent(new Event('open-settings'))}
        >
          <span className="gcal-banner-icon">📅</span>
          Connect Google Calendar in Settings to enable sync
        </div>
      )}
      {/* Header */}
      <div className="cal-header stagger-1">
        <div className="cal-header-left">
          <h1 className="dash-title" style={{ marginBottom: 0 }}>Calendar</h1>
          <div className="page-subtitle">{headerLabel(view, currentDate)}</div>
        </div>
        <div className="cal-header-controls">
          <div className="cal-view-switcher">
            {['day', 'week', 'month'].map(v => (
              <button
                key={v}
                className={view === v ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '6px 14px', fontSize: '0.8125rem' }}
                onClick={() => setView(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="cal-nav-group">
            <button className="cal-nav-btn" onClick={() => navigate(-1)}>‹</button>
            <button className="btn-secondary" style={{ padding: '7px 14px', fontSize: '0.8125rem' }} onClick={() => {
              const [y, m, d] = getActiveDateString().split('-').map(Number)
              setCurrentDate(new Date(y, m - 1, d))
            }}>Today</button>
            <button className="cal-nav-btn" onClick={() => navigate(1)}>›</button>
          </div>
          <button
            className="btn-ghost"
            style={{ padding: '8px 14px', fontSize: '0.8125rem' }}
            onClick={() => setShowAIPlanner(v => !v)}
          >
            ✦ AI
          </button>
          <button
            className="btn-primary"
            style={{ padding: '8px 16px', fontSize: '0.8125rem' }}
            onClick={() => { setDefaultSlot(null); setEditEvent(null); setShowSidebar(true) }}
          >
            + New
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="cal-body-wrap stagger-2">
        <div className={`cal-main${showDayReview && view === 'day' ? ' cal-main--reviewing' : ''}`}>
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
              timeboxArmed={armedTask}
              onTimeboxPlace={handleTimeboxPlace}
            />
          )}
          {showDayReview && view === 'day' && (
            <DayReviewPanel
              date={currentDate}
              events={events}
              gymPlanned={gymPlanned}
              onClose={() => setShowDayReview(false)}
            />
          )}
          {view === 'month' && (
            <MonthView
              currentDate={currentDate}
              events={events}
              gymPlanned={gymPlanned}
              dayReviews={dayReviews}
              onDateSelect={handleDateSelect}
              onEventClick={handleEventClick}
            />
          )}
        </div>
      </div>

      {/* Full-width review bar — only when past day, day view, panel not yet open */}
      {view === 'day' && dayDiff(currentDate) < 0 && !showDayReview && (
        <div className="cal-review-bar">
          <button className="cal-review-bar-btn" onClick={() => setShowDayReview(true)}>
            ◎ Review Day
          </button>
        </div>
      )}

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

      {showAIPlanner && (
        <AIPlannerPanel
          events={events}
          gymPlanned={gymPlanned}
          onEventsAdd={handleAIEventsAdd}
          onClose={() => setShowAIPlanner(false)}
        />
      )}

    </div>
  )
}
