import { useState } from 'react'
import { getMonthGrid, isSameDay, getBusyScore, formatMonthYear, hasGymOnDay } from './calendarUtils.js'

export default function MiniMonth({ currentDate, events, gymPlanned, onSelect }) {
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(currentDate)
    d.setDate(1)
    return d
  })

  const today = new Date()
  const grid = getMonthGrid(viewDate.getFullYear(), viewDate.getMonth())

  const prev = () => setViewDate(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n })
  const next = () => setViewDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n })

  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <div className="cal-mini-month">
      <div className="cal-mini-nav">
        <button className="cal-mini-nav-btn" onClick={prev}>‹</button>
        <span className="cal-mini-nav-label">
          {viewDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
        </span>
        <button className="cal-mini-nav-btn" onClick={next}>›</button>
      </div>

      <div className="cal-mini-dow">
        {DOW.map((d, i) => (
          <div key={i} className="cal-mini-dow-label">{d}</div>
        ))}
      </div>

      <div className="cal-mini-grid">
        {grid.flat().map(({ date, inMonth }, i) => {
          const isToday = isSameDay(date, today)
          const isSelected = isSameDay(date, currentDate)
          const busyScore = inMonth ? getBusyScore(date, events, gymPlanned) : 0
          const amberAlpha = busyScore * 0.55

          return (
            <button
              key={i}
              className={`cal-mini-cell${inMonth ? ' in-month' : ''}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => onSelect(date)}
              style={
                inMonth && busyScore > 0 && !isToday && !isSelected
                  ? { background: `rgba(232,160,32,${amberAlpha})`, color: busyScore > 0.3 ? '#E8A020' : undefined }
                  : undefined
              }
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
