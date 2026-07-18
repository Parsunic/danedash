import { useState, useEffect, useRef } from 'react'
import { storeGet } from '../../../lib/storage.js'
import { getDayEvents } from '../../calendar/calendarUtils.js'

// Day Ring card widget (chromeless — .day-ring-section supplies its own chrome).
// Ring math + helpers copied verbatim from Dashboard.jsx.
// M: compact horizontal ring + % + phase. L: exactly today's presentation.
// XL: L's ring + right panel with a 6:30→21:30 day-timeline bar (read-only).

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

// 0–100 position of a Date along the 6:30 AM → 9:30 PM day-timeline.
function timelinePct(date) {
  const h = date.getHours() + date.getMinutes() / 60
  const t = (h - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR)
  return Math.max(0, Math.min(1, t)) * 100
}

function loadTimelineEvents() {
  const calEvents = storeGet('calendar_events') || []
  const gymPlanned = storeGet('gym_planned') || []
  return getDayEvents(new Date(), calEvents, gymPlanned)
    .filter(e => !e.is_all_day)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
}

export default function DayRingWidget({ size, bp }) {
  const [data, setData] = useState(computeRingData)
  const [animOffset, setAnimOffset] = useState(RING_C)
  const [animPct, setAnimPct] = useState(() => {
    const d = computeRingData()
    return d.pct === '—' ? '—' : '0%'
  })
  const [events, setEvents] = useState([])
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

  // Mount animation — arc draws, counter counts up.
  // hasMounted guard: runs once per mount; size changes never replay it.
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

  // XL only: today's events for the day-timeline (read-only)
  useEffect(() => {
    if (size !== 'XL') return
    const load = () => setEvents(loadTimelineEvents())
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
  }, [size])

  const isM = size === 'M'
  const isXL = size === 'XL'
  const mobile = bp === 'mobile'
  const ringPx = isM ? 72 : 168
  const nowPct = timelinePct(new Date())

  const sectionStyle = {
    height: '100%', marginBottom: 0, overflow: 'hidden',
    ...(isM ? { padding: '10px 16px', gap: 18, flexWrap: 'nowrap' } : null),
    ...(!isM && !isXL && mobile ? { flexDirection: 'column', gap: 8, padding: 14 } : null),
    ...(isXL ? (mobile
      ? { flexDirection: 'column', gap: 16, padding: 18, flexWrap: 'nowrap', justifyContent: 'flex-start' }
      : { gap: 44, padding: '24px 36px', flexWrap: 'nowrap', justifyContent: 'center' }) : null),
  }

  return (
    <div className="day-ring-section" style={sectionStyle}>
      <div className="day-ring-wrap" style={{ width: ringPx, height: ringPx }}>
        <svg viewBox="0 0 120 120" fill="none">
          <defs>
            <filter id="dc-ring-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feFlood floodColor="#E8A020" floodOpacity="0.55" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="shadow" />
              <feMerge>
                <feMergeNode in="shadow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
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
            filter="url(#dc-ring-glow)"
          />
        </svg>
        {!isM && (
          <div className="day-ring-overlay">
            <div className="day-ring-pct">{animPct}</div>
            <div className="day-ring-phase">{data.phase}</div>
            <div className="day-ring-clock">{data.clock}</div>
          </div>
        )}
      </div>

      {isM && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
          <div className="day-ring-pct" style={{ fontSize: 30 }}>{animPct}</div>
          <div className="day-ring-phase" style={{ marginTop: 3 }}>{data.phase}</div>
        </div>
      )}

      {size === 'L' && (
        <div className="day-ring-info" style={mobile ? { alignItems: 'center', textAlign: 'center', gap: 4 } : null}>
          <div className="day-ring-status">{data.status}</div>
          <div className="day-ring-remaining">{data.remaining}</div>
          <div className="day-ring-range">6:30 AM – 9:30 PM</div>
        </div>
      )}

      {isXL && (
        <div className="day-ring-info" style={{ maxWidth: 'none', flex: 1, width: mobile ? '100%' : undefined, gap: 8, minWidth: 0 }}>
          <div className="day-ring-status">{data.status}</div>
          <div className="day-ring-remaining">{data.remaining}</div>
          <div style={{ marginTop: 10 }}>
            <div style={{ position: 'relative', height: 34 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 16, height: 2, background: 'rgba(255,255,255,0.10)', borderRadius: 1 }} />
              <div style={{ position: 'absolute', left: 0, top: 16, height: 2, width: nowPct + '%', background: 'rgba(232,160,32,0.45)', borderRadius: 1 }} />
              {events.map((e, i) => (
                <div
                  key={(e.id || i) + '' + e.start_time}
                  title={e.title}
                  style={{
                    position: 'absolute',
                    left: `calc(${timelinePct(new Date(e.start_time))}% - 1px)`,
                    top: 10, width: 2, height: 14, borderRadius: 1,
                    background: e.color || '#F2C063',
                  }}
                />
              ))}
              <div style={{
                position: 'absolute', left: `calc(${nowPct}% - 4px)`, top: 12,
                width: 8, height: 8, borderRadius: '50%',
                background: 'var(--accent)', boxShadow: '0 0 8px rgba(232,160,32,0.8)',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
              <span>6:30 AM</span>
              <span>9:30 PM</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
