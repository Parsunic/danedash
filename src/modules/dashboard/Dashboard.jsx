import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { storeGet } from '../../lib/storage.js'
import { getActiveDateString } from '../../lib/dateHelpers.js'
import { getDayEvents } from '../calendar/calendarUtils.js'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'

const RING_C = 2 * Math.PI * 52
const WAKE_HOUR = 6.5
const SLEEP_HOUR = 21.5
const SUN_PALETTE = [
  [255, 216, 158], [255, 205, 121], [255, 227, 143], [255, 183, 106],
  [255, 149,  89], [243, 111,  79], [226,  93, 122], [123,  91, 176], [47, 58, 102],
]

function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function getSunColor(pct) {
  const stops = 8, idx = (pct / 100) * stops
  const lo = Math.floor(idx), hi = Math.min(lo + 1, stops)
  return lerpColor(SUN_PALETTE[lo], SUN_PALETTE[hi], idx - lo)
}

function fmtClock(now) {
  let h = now.getHours()
  const m = now.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

function fmtDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60), m = Math.round(totalMinutes % 60)
  return h === 0 ? `${m}m` : `${h}h ${m}m`
}

function computeRingData() {
  const now = new Date()
  const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  const clock = fmtClock(now)
  if (hours < WAKE_HOUR) {
    return {
      dashOffset: RING_C, strokeColor: '#4D4B47',
      pct: '—', phase: 'SLEEPING',
      status: '😴 Still sleeping',
      remaining: fmtDuration((WAKE_HOUR - hours) * 60) + ' until wake-up',
      clock,
    }
  }
  if (hours < SLEEP_HOUR) {
    const pct = (hours - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR) * 100
    const [r, g, b] = getSunColor(Math.min(pct, 100))
    let phase, status
    if (pct < 25)       { phase = 'MORNING';    status = '☀️ Morning — fresh start' }
    else if (pct < 50)  { phase = 'MIDDAY';     status = '⚡ Midday — keep moving' }
    else if (pct < 75)  { phase = 'AFTERNOON';  status = '🔥 Afternoon — push it' }
    else if (pct < 90)  { phase = 'EVENING';    status = '⏳ Evening — wrap up' }
    else                { phase = 'BEDTIME';    status = '🌙 Bedtime soon' }
    return {
      dashOffset: RING_C * (1 - pct / 100),
      strokeColor: `rgb(${r},${g},${b})`,
      pct: Math.round(pct) + '%', phase, status,
      remaining: fmtDuration((SLEEP_HOUR - hours) * 60) + ' awake time left',
      clock,
    }
  }
  return {
    dashOffset: 0, strokeColor: '#E25D7A',
    pct: '100%', phase: 'PAST BEDTIME',
    status: '⚠️ Past bedtime', remaining: 'Sleep!',
    clock,
  }
}

// ── GOAL TICKER ──
function GoalTicker() {
  const [meta, setMeta] = useState({ done: 0, total: 0 })
  const [rows, setRows] = useState([])
  const cycleIdxRef = useRef(0)
  const rowIdRef = useRef(0)

  const getItems = useCallback(() => {
    const goals = storeGet('goals:' + getActiveDateString()) || []
    const total = goals.length
    const done = goals.filter(g => g.done).length
    if (total === 0) return { items: [{ status: 'empty', text: 'No goals set for today — add one to get rolling.' }], done, total }
    if (done === total) return { items: [{ status: 'done', text: '✓ All goals done — solid day.' }], done, total }
    return { items: goals.filter(g => !g.done).map(g => ({ status: 'pending', text: g.text })), done, total }
  }, [])

  const tick = useCallback((first = false) => {
    const { items, done, total } = getItems()
    setMeta({ done, total })
    cycleIdxRef.current = cycleIdxRef.current % items.length
    const item = items[cycleIdxRef.current]
    cycleIdxRef.current = (cycleIdxRef.current + 1) % items.length
    const id = ++rowIdRef.current
    if (first) {
      setRows([{ id, item, cls: '' }])
      return
    }
    setRows(prev => [
      ...prev.map(r => ({ ...r, cls: 'is-leaving' })),
      { id, item, cls: 'is-entering' },
    ])
    setTimeout(() => setRows(prev => prev.filter(r => r.cls !== 'is-leaving')), 460)
  }, [getItems])

  useEffect(() => {
    tick(true)
    const interval = setInterval(() => tick(false), 5000)
    const onChanged = () => { cycleIdxRef.current = 0; tick(false) }
    window.addEventListener('goals-changed', onChanged)
    return () => {
      clearInterval(interval)
      window.removeEventListener('goals-changed', onChanged)
    }
  }, [tick])

  return (
    <div className="ticker-row">
      <div className="goal-ticker" aria-live="polite" aria-atomic="true">
        <div className="goal-ticker-led"><span className="goal-ticker-led-dot" /></div>
        <div className="goal-ticker-label">GOALS</div>
        <div className="goal-ticker-stage">
          {rows.map(({ id, item, cls }) => (
            <div key={id} className={`goal-ticker-row${cls ? ' ' + cls : ''}`}>
              <span className="goal-ticker-status" data-status={item.status}>
                {item.status === 'done' ? '✓' : item.status === 'pending' ? '○' : '·'}
              </span>
              <span className="goal-ticker-text">{item.text}</span>
            </div>
          ))}
        </div>
        <div className="goal-ticker-meta">{meta.done}/{meta.total}</div>
      </div>
    </div>
  )
}

// ── DAY RING ──
function DayRing() {
  const [data, setData] = useState(computeRingData)
  const [animOffset, setAnimOffset] = useState(RING_C)
  const [animPct, setAnimPct] = useState(() => {
    const d = computeRingData()
    return d.pct === '—' ? '—' : '0%'
  })
  const animRaf = useRef(null)
  const hasMounted = useRef(false)

  // Minute tick — update data and snap display values forward
  useEffect(() => {
    const timer = setInterval(() => {
      const d = computeRingData()
      setData(d)
      setAnimOffset(d.dashOffset)
      setAnimPct(d.pct)
    }, 60000)
    return () => clearInterval(timer)
  }, [])

  // Mount animation — arc draws, counter counts up
  useEffect(() => {
    if (hasMounted.current) return
    hasMounted.current = true
    const d = data
    const targetOffset = d.dashOffset
    const pctNum = d.pct !== '—' ? parseInt(d.pct) : null

    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimOffset(targetOffset))
    })

    if (pctNum !== null) {
      const DURATION = 1200
      const start = performance.now()
      const step = (now) => {
        const t = Math.min((now - start) / DURATION, 1)
        const eased = 1 - Math.pow(1 - t, 3)
        setAnimPct(Math.round(eased * pctNum) + '%')
        if (t < 1) { animRaf.current = requestAnimationFrame(step) }
        else { setAnimPct(d.pct) }
      }
      animRaf.current = requestAnimationFrame(step)
    }
    return () => { if (animRaf.current) cancelAnimationFrame(animRaf.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="day-ring-section">
      <div className="day-ring-wrap">
        <svg viewBox="0 0 120 120" fill="none">
          <circle cx="60" cy="60" r="52" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <circle
            className="ring-fill-circle"
            cx="60" cy="60" r="52"
            fill="none"
            stroke={data.strokeColor}
            strokeWidth="8"
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
            strokeDasharray={RING_C}
            strokeDashoffset={animOffset}
          />
        </svg>
        <div className="day-ring-overlay">
          <div className="day-ring-pct">{animPct}</div>
          <div className="day-ring-phase">{data.phase}</div>
          <div className="day-ring-clock">{data.clock}</div>
        </div>
      </div>
      <div className="day-ring-info">
        <div className="day-ring-status">{data.status}</div>
        <div className="day-ring-remaining">{data.remaining}</div>
        <div className="day-ring-range">6:30 AM – 9:30 PM</div>
      </div>
    </div>
  )
}

// ── TOP TASKS WIDGET ──
function TopTasksWidget() {
  const [tasks, setTasks] = useState([])

  const load = useCallback(() => {
    const goals = storeGet('goals:' + getActiveDateString()) || []
    const queued = goals.filter(g => g.queued && !g.done)
    if (queued.length >= 1) {
      setTasks(queued.slice(0, 2))
    } else {
      setTasks(goals.filter(g => !g.done).slice(0, 2))
    }
  }, [])

  useEffect(() => {
    load()
    window.addEventListener('goals-changed', load)
    return () => window.removeEventListener('goals-changed', load)
  }, [load])

  return (
    <div className="dash-widget card-interactive">
      <div className="dash-widget-header">
        <span className="dash-widget-label">Queue</span>
        <Link to="/todo" className="dash-widget-link">To-Do →</Link>
      </div>
      {tasks.length === 0 ? (
        <div className="dash-widget-empty">All clear — nothing queued</div>
      ) : (
        tasks.map((t, i) => (
          <div key={i} className={`dash-task-chip${t.queued ? ' is-queued' : ''}`}>
            <span className="dash-task-bullet">{t.queued ? '⚡' : '○'}</span>
            <span className="dash-task-text">{t.text}</span>
          </div>
        ))
      )}
    </div>
  )
}

// ── CALENDAR NOW WIDGET ──
function fmtEventTime(iso) {
  const d = new Date(iso)
  const h = d.getHours(), m = d.getMinutes()
  const ap = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`
}

function CalendarNowWidget() {
  const [now, setNow] = useState(() => new Date())
  const [current, setCurrent] = useState(null)
  const [next, setNext] = useState(null)

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
    setNext(allToday.find(e => new Date(e.start_time) > nowDate) || null)
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    window.addEventListener('schedule-sync', load)
    window.addEventListener('gym-changed', load)
    return () => {
      clearInterval(id)
      window.removeEventListener('schedule-sync', load)
      window.removeEventListener('gym-changed', load)
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

  return (
    <div className="dash-widget card-interactive">
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
      {next && (
        <div className="dash-next-event">
          <div className="dash-next-label">NEXT</div>
          <div className="dash-next-title">{next.title}</div>
          <div className="dash-next-time">{fmtEventTime(next.start_time)} · {timeUntil(next.start_time)}</div>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  return (
    <>
      <BackgroundBlob page="dashboard" />
      <h1 className="dash-title">Dane's Dashboard</h1>
      <GoalTicker />
      <div className="dash-desktop-layout">
        <div className="dash-main-col stagger-1">
          <DayRing />
        </div>
        <div className="dash-side-col stagger-2">
          <TopTasksWidget />
          <CalendarNowWidget />
        </div>
      </div>
    </>
  )
}
