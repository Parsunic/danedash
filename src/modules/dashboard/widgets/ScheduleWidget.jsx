import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { storeGet } from '../../../lib/storage.js'
import { getDayEvents } from '../../calendar/calendarUtils.js'

// Schedule widget — copied from Dashboard.jsx CalendarNowWidget.
// S: single block (NOW + time-left, or NEXT + "in Xh" when idle).
// M: today's NOW + NEXT side by side. L: NOW + rest-of-day agenda + count line.

function fmtEventTime(iso) {
  const d = new Date(iso)
  const h = d.getHours(), m = d.getMinutes()
  const ap = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`
}

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const ONE_LINE = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

export default function ScheduleWidget({ size, bp }) {
  const [now, setNow] = useState(() => new Date())
  const [current, setCurrent] = useState(null)
  const [upcoming, setUpcoming] = useState([])

  const load = useCallback(() => {
    const nowDate = new Date()
    setNow(nowDate)
    const calEvents = storeGet('calendar_events') || []
    const gymPlanned = storeGet('gym_planned') || []
    const today = new Date()
    const allToday = getDayEvents(today, calEvents, gymPlanned)
      .filter(e => !e.is_all_day)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

    setCurrent(allToday.find(e => new Date(e.start_time) <= nowDate && new Date(e.end_time) > nowDate) || null)
    setUpcoming(allToday.filter(e => new Date(e.start_time) > nowDate))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    window.addEventListener('schedule-sync', load)
    window.addEventListener('gym-changed', load)
    window.addEventListener('sync-applied', load)
    return () => {
      clearInterval(id)
      window.removeEventListener('schedule-sync', load)
      window.removeEventListener('gym-changed', load)
      window.removeEventListener('sync-applied', load)
    }
  }, [load])

  function timeLeft(endTime) {
    const diff = Math.max(0, new Date(endTime) - now)
    const mins = Math.floor(diff / 60000)
    const h = Math.floor(mins / 60), m = mins % 60
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`
  }

  function timeUntil(startTime) {
    const diff = Math.max(0, new Date(startTime) - now)
    const mins = Math.floor(diff / 60000)
    const h = Math.floor(mins / 60), m = mins % 60
    if (h >= 12) return `in ${h}h`
    return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`
  }

  const next = upcoming[0] || null

  // ── S: one compact block ──
  if (size === 'S') {
    return (
      <div style={ROOT_STYLE}>
        {current ? (
          <>
            <div className="dash-now-label">Now</div>
            <div className="dash-now-title" style={ONE_LINE}>{current.title}</div>
            <div className="dash-now-remaining" style={{ marginTop: 2 }}>{timeLeft(current.end_time)}</div>
          </>
        ) : next ? (
          <>
            <div className="dash-next-label">Next</div>
            <div className="dash-next-title" style={ONE_LINE}>{next.title}</div>
            <div className="dash-next-time" style={{ marginTop: 2 }}>{timeUntil(next.start_time)}</div>
          </>
        ) : (
          <div className="dash-widget-empty">Nothing scheduled right now</div>
        )}
        <div style={{ marginTop: 'auto' }}>
          <span className="dash-widget-label">Schedule</span>
        </div>
      </div>
    )
  }

  // ── M: today's NOW + NEXT ──
  if (size === 'M') {
    return (
      <div style={ROOT_STYLE}>
        <div className="dash-widget-header" style={{ marginBottom: 8 }}>
          <span className="dash-widget-label">Schedule</span>
          <Link to="/calendar" className="dash-widget-link">Calendar →</Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1, minHeight: 0 }}>
          {current ? (
            <div className="dash-now-event" style={{ margin: 0, padding: '8px 12px', overflow: 'hidden' }}>
              <div className="dash-now-label" style={{ marginBottom: 3 }}>Now</div>
              <div className="dash-now-title" style={ONE_LINE}>{current.title}</div>
              <div className="dash-now-remaining" style={{ marginTop: 2 }}>{timeLeft(current.end_time)}</div>
            </div>
          ) : (
            <div className="dash-now-empty" style={{ padding: '8px 2px' }}>Nothing scheduled right now</div>
          )}
          {next ? (
            <div className="dash-next-event" style={{ padding: '8px 12px', overflow: 'hidden' }}>
              <div className="dash-next-label" style={{ marginBottom: 3 }}>Next</div>
              <div className="dash-next-title" style={ONE_LINE}>{next.title}</div>
              <div className="dash-next-time">{fmtEventTime(next.start_time)} · {timeUntil(next.start_time)}</div>
            </div>
          ) : (
            <div className="dash-widget-empty" style={{ padding: '8px 2px' }}>Free after this</div>
          )}
        </div>
      </div>
    )
  }

  // ── L: NOW + rest-of-day agenda ──
  return (
    <div style={ROOT_STYLE}>
      <div className="dash-widget-header">
        <span className="dash-widget-label">Schedule</span>
        <Link to="/calendar" className="dash-widget-link">Calendar →</Link>
      </div>
      {current ? (
        <div className="dash-now-event">
          <div className="dash-now-label">NOW</div>
          <div className="dash-now-title">{current.title}</div>
          <div className="dash-now-time">{fmtEventTime(current.start_time)} – {fmtEventTime(current.end_time)}</div>
          <div className="dash-now-remaining">{timeLeft(current.end_time)}</div>
        </div>
      ) : (
        <div className="dash-now-empty">Nothing scheduled right now</div>
      )}
      {upcoming.slice(0, 4).map((e, i) => (
        <div
          key={(e.id || i) + '' + e.start_time}
          style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 2px', minWidth: 0 }}
        >
          <span className="dash-next-time" style={{ width: 58, flexShrink: 0 }}>{fmtEventTime(e.start_time)}</span>
          <span className="dash-next-title" style={{ ...ONE_LINE, flex: 1, marginBottom: 0 }}>{e.title}</span>
        </div>
      ))}
      {!current && upcoming.length === 0 && (
        <div className="dash-widget-empty">Day's clear — nothing on the books.</div>
      )}
      <div className="dash-next-time" style={{ marginTop: 'auto', paddingTop: 8 }}>
        {upcoming.length} event{upcoming.length === 1 ? '' : 's'} left today
      </div>
    </div>
  )
}
