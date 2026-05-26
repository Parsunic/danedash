import { useState, useEffect, useRef, useCallback } from 'react'
import { storeGet } from '../../lib/storage.js'
import { getActiveDateString } from '../../lib/dateHelpers.js'

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

  useEffect(() => {
    const timer = setInterval(() => setData(computeRingData()), 60000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="day-ring-section">
      <div className="day-ring-wrap">
        <svg viewBox="0 0 120 120" fill="none">
          <defs>
            <filter id="ringGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
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
            filter="url(#ringGlow)"
            transform="rotate(-90 60 60)"
            strokeDasharray={RING_C}
            strokeDashoffset={data.dashOffset}
          />
        </svg>
        <div className="day-ring-overlay">
          <div className="day-ring-pct">{data.pct}</div>
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

export default function Dashboard() {
  return (
    <>
      <h1 className="dash-title">Dane's Dashboard</h1>
      <GoalTicker />
      <DayRing />
    </>
  )
}
