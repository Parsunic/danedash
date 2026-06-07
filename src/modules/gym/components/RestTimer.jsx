import { useState, useEffect } from 'react'

const PRESETS = [30, 60, 90, 120, 180, 240]

function fmtTime(r) {
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`
}

export default function RestTimer({ restState, onDismiss, onPreset, onTogglePause }) {
  const [expanded, setExpanded] = useState(false)
  const { visible, remaining, total, paused, lastSecs } = restState
  const r = Math.max(remaining, 0)
  const done = remaining <= 0

  // Auto-expand at ≤15s or when done
  useEffect(() => {
    if (visible && (r <= 15 || done)) setExpanded(true)
  }, [r, visible, done])

  // Reset on hide
  useEffect(() => {
    if (!visible) setExpanded(false)
  }, [visible])

  const handlePreset = (secs) => {
    onPreset(secs)
    setExpanded(false)
  }

  const handleDismiss = () => {
    onDismiss()
    setExpanded(false)
  }

  if (!visible) return null

  const pct = total > 0 ? r / total : 0
  const circ = 2 * Math.PI * 11
  const dashOffset = circ * (1 - pct)
  const strokeColor = done ? 'var(--success)' : 'var(--accent)'

  if (!expanded) {
    return (
      <button className="rest-timer-pill" onClick={() => setExpanded(true)} title="Rest timer">
        <svg viewBox="0 0 26 26" width="18" height="18" style={{ flexShrink: 0 }}>
          <circle cx="13" cy="13" r="11" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
          <circle cx="13" cy="13" r="11" fill="none"
            stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={dashOffset}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: done ? 'none' : 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <span className="rest-pill-time">{fmtTime(r)}</span>
      </button>
    )
  }

  return (
    <div className="rest-timer-compact">
      <div className="rest-compact-top">
        <span
          className={`rest-compact-time${done ? ' done' : ''}`}
          onClick={!done && r > 0 ? onTogglePause : undefined}
          title={!done && r > 0 ? (paused ? 'Resume' : 'Pause') : undefined}
          style={{ cursor: !done && r > 0 ? 'pointer' : 'default' }}
        >
          {done ? '✓ Done' : fmtTime(r)}
          {paused && !done && <span className="rest-compact-paused"> · paused</span>}
        </span>
        <button className="rest-timer-dismiss" onClick={handleDismiss}>✕</button>
      </div>
      <div className="rest-timer-presets">
        {PRESETS.map(secs => (
          <button
            key={secs}
            className={`rest-preset-btn${lastSecs === secs ? ' active' : ''}`}
            onClick={() => handlePreset(secs)}
          >
            {secs < 60 ? `${secs}s` : `${secs / 60}m`}
          </button>
        ))}
      </div>
    </div>
  )
}
