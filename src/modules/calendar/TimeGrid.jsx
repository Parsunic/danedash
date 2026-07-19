import { useState, useRef, useEffect } from 'react'
import MiniMonth from './MiniMonth.jsx'
import { useUIEdit } from '../../contexts/UIEditContext.jsx'
import {
  HOUR_HEIGHT, HOURS, getEventStyle,
  isSameDay, getWeekDays, formatHour, formatTimeRange,
  isSleepHour, minutesFromMidnight, getDayEvents, hasGymOnDay,
  snapToTen,
} from './calendarUtils.js'

const isDesktop = window.matchMedia('(min-width: 1024px)').matches

// B4: mobile week 3-day window sizing
const WINDOW_SIZE = 3
const MAX_WINDOW_START = 7 - WINDOW_SIZE // 4 → windows start at 0..4
function clampWindowStart(s) { return Math.max(0, Math.min(MAX_WINDOW_START, s)) }

// Assign non-overlapping columns to concurrent events (Google Calendar style)
function computeEventLayout(dayEvs) {
  if (!dayEvs.length) return []
  const items = dayEvs.map(ev => {
    const s = new Date(ev.start_time)
    const e = new Date(ev.end_time)
    return {
      ev,
      start: s.getHours() * 60 + s.getMinutes(),
      end: Math.max(e.getHours() * 60 + e.getMinutes(), s.getHours() * 60 + s.getMinutes() + 1),
      col: 0,
      totalCols: 1,
    }
  }).sort((a, b) => a.start - b.start)

  const colEnds = []
  for (const item of items) {
    let col = colEnds.findIndex(end => end <= item.start)
    if (col === -1) { col = colEnds.length; colEnds.push(0) }
    item.col = col
    colEnds[col] = item.end
  }

  // Expand totalCols to the highest column used by any overlapping peer
  for (let i = 0; i < items.length; i++) {
    let maxCol = items[i].col
    for (let j = 0; j < items.length; j++) {
      if (i !== j && items[i].start < items[j].end && items[j].start < items[i].end) {
        maxCol = Math.max(maxCol, items[j].col)
      }
    }
    items[i].totalCols = Math.max(items[i].col + 1, maxCol + 1)
  }

  return items
}

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
  onEventUpdate,
  onSkipGymWorkout,
  timeboxArmed,     // F5: armed shelf chip { goalId, title } | null
  onTimeboxPlace,   // F5: (date, startMin, task) → create 45-min task event
}) {
  // Global card-edit mode (Settings → Edit Layout) suspends TimeGrid's own drag
  // create/move/resize so it can't fight the card system. Safe default (false)
  // outside the provider.
  const { editing } = useUIEdit()

  // ── B4: mobile week 3-day sliding window ─────────────────────────────────
  // Reactive phone-width flag (≤600px) — swaps between the 3-day window and the
  // full 7-column week live on resize / rotate, no reload.
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 600px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)')
    const onChange = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Window = 3 consecutive days, start clamped 0..4 so every window is exactly
  // 3 columns; moved ±1 day per swipe / chevron.
  const [weekWindowStart, setWeekWindowStart] = useState(() => clampWindowStart(currentDate.getDay() - 1))
  const shiftWindow = (dir) => setWeekWindowStart(s => clampWindowStart(s + dir))

  // Reposition the window to include the anchor day whenever currentDate's day
  // changes (first open anchors on today; also Today button, week nav, day tap).
  // Swipes change only weekWindowStart, so a swiped position persists.
  const anchorKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}-${currentDate.getDate()}`
  useEffect(() => {
    setWeekWindowStart(clampWindowStart(currentDate.getDay() - 1))
  }, [anchorKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const allDays = view === 'week' ? getWeekDays(currentDate) : [currentDate]
  const windowed = view === 'week' && isMobile          // 3-day window active
  const days = windowed ? allDays.slice(weekWindowStart, weekWindowStart + WINDOW_SIZE) : allDays
  const scrollRef = useRef(null)
  const colsWrapRef = useRef(null)
  const [now, setNow] = useState(new Date())
  const dragRef = useRef(null)
  const didDragRef = useRef(false)
  const [dragState, setDragState] = useState(null)
  const today = new Date()

  // Zoom
  const [zoomLevel, setZoomLevel] = useState(1.0)
  const zoomLevelRef = useRef(1.0)
  const effHHRef = useRef(HOUR_HEIGHT)
  zoomLevelRef.current = zoomLevel
  const effHH = HOUR_HEIGHT * zoomLevel
  effHHRef.current = effHH

  // Keep latest callbacks + data in refs so global effects don't re-bind
  const onCreateRef = useRef(onCreateEvent)
  const onUpdateRef = useRef(onEventUpdate)
  const eventsRef   = useRef(events)
  const daysRef     = useRef(days)
  useEffect(() => { onCreateRef.current  = onCreateEvent }, [onCreateEvent])
  useEffect(() => { onUpdateRef.current  = onEventUpdate }, [onEventUpdate])
  useEffect(() => { eventsRef.current    = events }, [events])
  useEffect(() => { daysRef.current      = days }, [days])

  // F5 timebox refs — read inside stable listeners (touch effect, drop handlers)
  const timeboxArmedRef   = useRef(timeboxArmed)
  const onTimeboxPlaceRef = useRef(onTimeboxPlace)
  useEffect(() => { timeboxArmedRef.current   = timeboxArmed }, [timeboxArmed])
  useEffect(() => { onTimeboxPlaceRef.current = onTimeboxPlace }, [onTimeboxPlace])

  // Scroll to current time on mount / view change
  useEffect(() => {
    if (scrollRef.current) {
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes()
      scrollRef.current.scrollTop = Math.max(0, (nowMins / 60) * effHHRef.current - 200)
    }
  }, [view])

  // Update clock every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  const nowMins = now.getHours() * 60 + now.getMinutes()
  const nowTop  = (nowMins / 60) * effHH

  const eventsPerDay    = days.map(day => getDayEvents(day, events, gymPlanned))
  const allDayPerDay    = eventsPerDay.map(d => d.filter(e => e.is_all_day))
  const timedPerDay     = eventsPerDay.map(d => d.filter(e => !e.is_all_day))
  const hasAnyAllDay    = allDayPerDay.some(d => d.length > 0)

  // Convert clientY → snapped minutes from midnight
  const clientYToSnapped = (clientY) => {
    const rect = scrollRef.current?.getBoundingClientRect()
    const scrollTop = scrollRef.current?.scrollTop || 0
    if (!rect) return 0
    const y = (clientY - rect.top) + scrollTop
    return Math.max(0, Math.min(24 * 60 - 10, snapToTen((y / effHHRef.current) * 60)))
  }

  // Zoom button handler — keeps view center pinned
  const handleZoomBtn = (dir) => {
    const factor = dir > 0 ? 1.35 : (1 / 1.35)
    const oldZoom = zoomLevelRef.current
    const newZoom = Math.max(0.3, Math.min(4.0, oldZoom * factor))
    if (newZoom === oldZoom) return
    const el = scrollRef.current
    if (el) {
      const center = el.scrollTop + el.clientHeight / 2
      const mins = (center / effHHRef.current) * 60
      const newEffHH = HOUR_HEIGHT * newZoom
      el.scrollTop = Math.max(0, (mins / 60) * newEffHH - el.clientHeight / 2)
    }
    zoomLevelRef.current = newZoom
    effHHRef.current = HOUR_HEIGHT * newZoom
    setZoomLevel(newZoom)
  }

  // ── TIMEBOX (F5): desktop chip drag-and-drop onto a day column ──
  const handleTimeboxDragOver = (e) => {
    if (editing) return
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('application/x-timebox')) {
      e.preventDefault()
    }
  }
  const handleTimeboxDrop = (di, e) => {
    if (editing) return
    const raw = e.dataTransfer ? e.dataTransfer.getData('application/x-timebox') : ''
    if (!raw) return
    e.preventDefault()
    e.stopPropagation()
    let task
    try { task = JSON.parse(raw) } catch { return }
    if (!task || !task.goalId) return
    onTimeboxPlaceRef.current?.(daysRef.current[di], clientYToSnapped(e.clientY), task)
  }

  // ── TIMEBOX (F5): placement mode — armed chip + plain tap on a slot places ──
  const handleTimeboxTap = (di, e) => {
    if (!timeboxArmedRef.current || editing) return
    onTimeboxPlaceRef.current?.(daysRef.current[di], clientYToSnapped(e.clientY), timeboxArmedRef.current)
  }

  // ── DESKTOP: column mouse-down → drag-to-create ──
  const handleColumnMouseDown = (di, e) => {
    if (timeboxArmed) return // placement mode: the click places instead
    if (editing) return
    if (!isDesktop || e.button !== 0) return
    e.preventDefault()
    const snapped = clientYToSnapped(e.clientY)
    dragRef.current = { type: 'create', dayIndex: di, startMin: snapped, endMin: snapped + 10 }
    setDragState({ type: 'create', dayIndex: di, startMin: snapped, endMin: snapped + 10 })
  }

  // ── DESKTOP: event mouse-down → move / resize ──
  const handleEventMouseDown = (ev, di, e) => {
    if (editing) return
    if (!isDesktop || e.button !== 0 || ev.is_gym_planned) return
    e.stopPropagation()
    e.preventDefault()
    didDragRef.current = false

    const rect = e.currentTarget.getBoundingClientRect()
    const yInEvent = e.clientY - rect.top
    const startMin = new Date(ev.start_time).getHours() * 60 + new Date(ev.start_time).getMinutes()
    const endMin   = new Date(ev.end_time).getHours()   * 60 + new Date(ev.end_time).getMinutes()

    let type
    if (yInEvent <= 8)                   type = 'resize-top'
    else if (yInEvent >= rect.height - 8) type = 'resize-bottom'
    else                                  type = 'move'

    dragRef.current = {
      type, dayIndex: di, eventId: ev.id,
      origStart: startMin, origEnd: endMin,
      grabOffset: type === 'move' ? (yInEvent / effHH) * 60 : 0,
      currentStart: startMin, currentEnd: endMin,
    }
    setDragState({ type, dayIndex: di, eventId: ev.id, currentStart: startMin, currentEnd: endMin })
  }

  // ── Global mouse-move (desktop drag) ──
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return
      const dr = dragRef.current
      const snapped = clientYToSnapped(e.clientY)

      if (dr.type === 'create') {
        const endMin = snapped > dr.startMin ? snapped : dr.startMin + 10
        dragRef.current.endMin = endMin
        setDragState(p => p ? { ...p, endMin } : null)
        return
      }

      const rect = scrollRef.current?.getBoundingClientRect()
      const scrollTop = scrollRef.current?.scrollTop || 0
      const rawMins = rect
        ? (((e.clientY - rect.top) + scrollTop) / effHHRef.current) * 60
        : snapped

      if (dr.type === 'move') {
        const duration = dr.origEnd - dr.origStart
        const newStart = snapToTen(Math.max(0, Math.min(24 * 60 - duration, rawMins - dr.grabOffset)))
        const newEnd   = newStart + duration
        if (newStart !== dr.currentStart) didDragRef.current = true
        dragRef.current.currentStart = newStart
        dragRef.current.currentEnd   = newEnd
        setDragState(p => p ? { ...p, currentStart: newStart, currentEnd: newEnd } : null)
      } else if (dr.type === 'resize-bottom') {
        const newEnd = Math.max(dr.origStart + 10, snapped)
        if (newEnd !== dr.currentEnd) didDragRef.current = true
        dragRef.current.currentEnd = newEnd
        setDragState(p => p ? { ...p, currentEnd: newEnd } : null)
      } else if (dr.type === 'resize-top') {
        const newStart = Math.min(dr.origEnd - 10, snapped)
        if (newStart !== dr.currentStart) didDragRef.current = true
        dragRef.current.currentStart = newStart
        setDragState(p => p ? { ...p, currentStart: newStart } : null)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, []) // uses refs only

  // ── Global mouse-up (desktop commit) ──
  useEffect(() => {
    const onUp = () => {
      if (!dragRef.current) return
      const dr = dragRef.current
      dragRef.current = null
      setDragState(null)

      if (dr.type === 'create') {
        onCreateRef.current({ date: daysRef.current[dr.dayIndex], startMin: dr.startMin, endMin: dr.endMin })
        return
      }

      if (!didDragRef.current) return

      const ev = eventsRef.current.find(e => e.id === dr.eventId)
      if (ev && onUpdateRef.current) {
        const base = new Date(ev.start_time)
        const y = base.getFullYear(), mo = base.getMonth(), d = base.getDate()
        const newStart = new Date(y, mo, d, Math.floor(dr.currentStart / 60), dr.currentStart % 60)
        const newEnd   = new Date(y, mo, d, Math.floor(dr.currentEnd   / 60), dr.currentEnd   % 60)
        onUpdateRef.current(dr.eventId, newStart.toISOString(), newEnd.toISOString())
      }
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, []) // uses refs only

  // ── Trackpad pinch-to-zoom (wheel + ctrlKey) — desktop only ──
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const delta = -e.deltaY * 0.003
      const oldZoom = zoomLevelRef.current
      const newZoom = Math.max(0.3, Math.min(4.0, oldZoom + delta))
      if (Math.abs(newZoom - oldZoom) < 0.0005) return

      const rect = el.getBoundingClientRect()
      const relY = Math.max(0, e.clientY - rect.top)
      const oldEffHH = effHHRef.current
      const newEffHH = HOUR_HEIGHT * newZoom
      el.scrollTop = Math.max(0, ((el.scrollTop + relY) / oldEffHH) * newEffHH - relY)

      zoomLevelRef.current = newZoom
      effHHRef.current = newEffHH
      setZoomLevel(newZoom)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Mobile: long-press to create + two-finger pinch to zoom ──
  useEffect(() => {
    if (isDesktop) return
    const el = scrollRef.current
    if (!el) return

    let timer = null
    let startX = 0, startY = 0
    let active = false

    let pinchActive = false
    let pinchStartDist = 0
    let pinchStartZoom = 1
    let pinchStartContentY = 0

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        clearTimeout(timer); timer = null; active = false
        pinchActive = true
        pinchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        pinchStartZoom = zoomLevelRef.current
        const rect = el.getBoundingClientRect()
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
        pinchStartContentY = el.scrollTop + midY
        return
      }

      // Timebox placement mode: a plain tap places (via the column click
      // handler) — suppress long-press-to-create entirely while armed.
      if (timeboxArmedRef.current) return

      // Global card-edit mode suspends long-press-to-create (pinch-zoom stays).
      if (editing) return

      pinchActive = false
      const t = e.touches[0]
      startX = t.clientX; startY = t.clientY
      active = false

      const containerRect = el.getBoundingClientRect()
      const y = (t.clientY - containerRect.top) + el.scrollTop
      const snapped = Math.max(0, Math.min(24 * 60 - 10, snapToTen((y / effHHRef.current) * 60)))

      const colsRect = colsWrapRef.current?.getBoundingClientRect()
      let di = 0
      if (colsRect && daysRef.current.length > 1) {
        const colW = colsRect.width / daysRef.current.length
        di = Math.max(0, Math.min(daysRef.current.length - 1, Math.floor((t.clientX - colsRect.left) / colW)))
      }

      timer = setTimeout(() => {
        active = true
        dragRef.current = { type: 'create', dayIndex: di, startMin: snapped, endMin: snapped + 30 }
        setDragState({ type: 'create', dayIndex: di, startMin: snapped, endMin: snapped + 30 })
      }, 400)
    }

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && pinchActive) {
        e.preventDefault()
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        const scale = dist / pinchStartDist
        const newZoom = Math.max(0.3, Math.min(4.0, pinchStartZoom * scale))
        const rect = el.getBoundingClientRect()
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
        const newEffHH = HOUR_HEIGHT * newZoom
        const oldEffHH = HOUR_HEIGHT * pinchStartZoom
        el.scrollTop = Math.max(0, (pinchStartContentY / oldEffHH) * newEffHH - midY)
        zoomLevelRef.current = newZoom
        effHHRef.current = newEffHH
        setZoomLevel(newZoom)
        return
      }

      const t = e.touches[0]
      if (timer && (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10)) {
        clearTimeout(timer); timer = null
      }
      if (!active || !dragRef.current) return
      e.preventDefault()
      const containerRect = el.getBoundingClientRect()
      const y = (t.clientY - containerRect.top) + el.scrollTop
      const snapped = Math.max(0, Math.min(24 * 60 - 10, snapToTen((y / effHHRef.current) * 60)))
      const endMin = Math.max(snapped, dragRef.current.startMin + 10)
      dragRef.current.endMin = endMin
      setDragState(p => p ? { ...p, endMin } : null)
    }

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) pinchActive = false
      clearTimeout(timer); timer = null
      if (active && dragRef.current) {
        const dr = dragRef.current
        dragRef.current = null
        setDragState(null)
        active = false
        onCreateRef.current({ date: daysRef.current[dr.dayIndex], startMin: dr.startMin, endMin: dr.endMin })
      }
      active = false
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
    }
  }, [editing]) // refs + editing (rebinds touch listeners when edit mode toggles)

  // ── B4: horizontal swipe on the grid → move the 3-day window (mobile week) ──
  // Owns the gesture: sets window.__swipeDisabled on touchstart so Layout's
  // page-swipe never fires, restores on end/cancel (same contract as card drags).
  useEffect(() => {
    const el = colsWrapRef.current
    if (!el || !windowed) return

    let sx = 0, sy = 0, tracking = false, decided = false, horizontal = false

    const onStart = (e) => {
      if (!e.touches || e.touches.length !== 1) return
      window.__swipeDisabled = true       // claim gesture: block Layout page-swipe
      sx = e.touches[0].clientX
      sy = e.touches[0].clientY
      tracking = true; decided = false; horizontal = false
    }
    const onMove = (e) => {
      if (!tracking || e.touches.length !== 1) return
      const dx = e.touches[0].clientX - sx
      const dy = e.touches[0].clientY - sy
      if (!decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        decided = true
        horizontal = Math.abs(dx) > Math.abs(dy)
      }
      if (decided && horizontal) e.preventDefault() // keep it a window-swipe, not a scroll
    }
    const onEnd = (e) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches && e.changedTouches[0]
      const dx = (t ? t.clientX : sx) - sx
      const dy = (t ? t.clientY : sy) - sy
      if (horizontal && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        setWeekWindowStart(s => clampWindowStart(s + (dx < 0 ? 1 : -1))) // swipe left → forward a day
      }
      window.__swipeDisabled = false
    }
    const onCancel = () => { tracking = false; window.__swipeDisabled = false }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onCancel)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
      window.__swipeDisabled = false
    }
  }, [windowed])

  const nowStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  return (
    <div className="cal-timegrid-wrap">
      {/* All-day strip */}
      {hasAnyAllDay && (
        <div className="cal-allday-row">
          <div className="cal-allday-gutter">all‑day</div>
          {days.map((day, di) => (
            <div key={di} className="cal-allday-cell">
              {allDayPerDay[di].map(ev => {
                const s = getEventStyle(ev)
                return (
                  <div
                    key={ev.id}
                    className="cal-allday-event"
                    style={{ background: s.bg, borderColor: s.borderColor, color: s.color }}
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
        <div className="cal-grid-layout" style={{ height: effHH * 24 }}>
          {/* Hour gutter */}
          <div className="cal-time-gutter">
            {HOURS.map(h => (
              <div key={h} className="cal-hour-label" style={{ top: h * effHH, height: effHH }}>
                {h > 0 ? formatHour(h) : null}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="cal-columns-wrap" ref={colsWrapRef}>
            {days.map((day, di) => {
              const isWeekend = day.getDay() === 0 || day.getDay() === 6
              const isToday   = isSameDay(day, today)
              const layout    = computeEventLayout(timedPerDay[di])

              return (
                <div
                  key={di}
                  className={`cal-day-col${isWeekend ? ' weekend' : ''}${isToday ? ' today' : ''}`}
                  onMouseDown={e => handleColumnMouseDown(di, e)}
                  onClick={e => handleTimeboxTap(di, e)}
                  onDragOver={handleTimeboxDragOver}
                  onDrop={e => handleTimeboxDrop(di, e)}
                >
                  {/* Hour rows — visual grid lines */}
                  {HOURS.map(h => (
                    <div
                      key={h}
                      className={`cal-hour-row${isSleepHour(h) ? ' sleep' : ''}`}
                      style={{ top: h * effHH, height: effHH }}
                    />
                  ))}

                  {/* Events */}
                  {layout.map(({ ev, col, totalCols }) => {
                    const isDragging = dragState?.eventId === ev.id && dragState?.dayIndex === di
                    const origStart = new Date(ev.start_time)
                    const origEnd   = new Date(ev.end_time)

                    let topPx, heightPx, displayStart, displayEnd
                    if (isDragging) {
                      topPx = (dragState.currentStart / 60) * effHH
                      const durMins = Math.max(dragState.currentEnd - dragState.currentStart, 10)
                      heightPx = (durMins / 60) * effHH
                      const y = origStart.getFullYear(), mo = origStart.getMonth(), d = origStart.getDate()
                      displayStart = new Date(y, mo, d, Math.floor(dragState.currentStart / 60), dragState.currentStart % 60)
                      displayEnd   = new Date(y, mo, d, Math.floor(dragState.currentEnd   / 60), dragState.currentEnd   % 60)
                    } else {
                      topPx = (minutesFromMidnight(origStart) / 60) * effHH
                      const durMins = Math.max((origEnd - origStart) / 60000, 1)
                      heightPx = (durMins / 60) * effHH
                      displayStart = origStart
                      displayEnd   = origEnd
                    }

                    const s         = getEventStyle(ev)
                    const renderedH = Math.max(heightPx - 2, 6)
                    const isTall    = renderedH > 42

                    // Horizontal offset for overlapping events
                    const colW  = 100 / totalCols
                    const colL  = col * colW
                    const evLeft  = totalCols > 1 ? `calc(${colL}% + 1px)`           : '2px'
                    const evRight = totalCols > 1 ? `calc(${100 - colL - colW}% + 1px)` : '2px'

                    return (
                      <div
                        key={ev.id}
                        className={`cal-event${ev.is_gym_planned ? ' is-gym' : ' user-event'}${isDragging ? ' is-dragging' : ''}`}
                        style={{
                          top: topPx + 1,
                          height: renderedH,
                          left: evLeft,
                          right: evRight,
                          background: s.bg,
                          borderLeft: `3px solid ${s.borderColor}`,
                          color: s.color,
                        }}
                        onMouseDown={e => handleEventMouseDown(ev, di, e)}
                        onClick={e => {
                          e.stopPropagation()
                          if (!didDragRef.current) onEventClick(ev)
                        }}
                        title={`${ev.title}\n${formatTimeRange(displayStart, displayEnd)}`}
                      >
                        {isDesktop && !ev.is_gym_planned && <div className="cal-event-rz-top" />}
                        {s.icon && <span className="cal-event-icon">{s.icon}</span>}
                        <div className="cal-event-body">
                          <div className="cal-event-title">{ev.title}</div>
                          {isTall && (
                            <div className="cal-event-time">{formatTimeRange(displayStart, displayEnd)}</div>
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
                        {isDesktop && !ev.is_gym_planned && <div className="cal-event-rz-bottom" />}
                      </div>
                    )
                  })}

                  {/* Drag-to-create preview */}
                  {dragState?.type === 'create' && dragState?.dayIndex === di && (
                    <div
                      className="cal-drag-preview"
                      style={{
                        top:    (dragState.startMin / 60) * effHH,
                        height: ((dragState.endMin - dragState.startMin) / 60) * effHH,
                      }}
                    />
                  )}

                  {/* Now line */}
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

      {/* Zoom controls */}
      <div className="cal-zoom-controls">
        <button className="cal-zoom-btn" onClick={() => handleZoomBtn(1)} title="Zoom in">+</button>
        <button className="cal-zoom-btn" onClick={() => handleZoomBtn(-1)} title="Zoom out">−</button>
      </div>

      {/* Mini month */}
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
