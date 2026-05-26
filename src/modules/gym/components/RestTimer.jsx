import { RT_CIRC } from '../gymUtils.js'

const PRESETS = [30, 60, 90, 120, 180, 240]

function fmtTime(r) {
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`
}

export default function RestTimer({ restState, onDismiss, onPreset, onTogglePause }) {
  if (!restState.visible) return null
  const { remaining, total, paused, lastSecs } = restState
  const r = Math.max(remaining, 0)
  const pct = total > 0 ? r / total : 0
  const dashOffset = RT_CIRC * (1 - pct)
  const done = remaining <= 0
  const strokeColor = done ? 'var(--success)' : 'var(--accent)'
  const sub = done ? 'DONE' : paused ? 'PAUSED' : 'REST'

  return (
    <div className="rest-timer-overlay visible">
      <div className="rest-timer-header">
        <span className="rest-timer-label">Rest Timer</span>
        <button className="rest-timer-dismiss" onClick={onDismiss} title="Dismiss">✕</button>
      </div>
      <div className="rest-timer-ring-wrap" onClick={onTogglePause} style={{ cursor: remaining > 0 ? 'pointer' : 'default' }}>
        <svg viewBox="0 0 96 96" width="96" height="96" style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle className="rest-timer-ring-bg" cx="48" cy="48" r="42" />
          <circle
            className="rest-timer-ring-fg"
            cx="48" cy="48" r="42"
            style={{
              stroke: strokeColor,
              strokeDasharray: RT_CIRC,
              strokeDashoffset: dashOffset,
              transition: !done ? 'stroke-dashoffset 1s linear' : 'none',
            }}
          />
        </svg>
        <div className="rest-timer-ring-label">
          <span className="rest-timer-time">{fmtTime(r)}</span>
          <span className="rest-timer-sub">{sub}</span>
        </div>
      </div>
      <div className="rest-timer-presets">
        {PRESETS.map(secs => (
          <button
            key={secs}
            className={`rest-preset-btn${lastSecs === secs ? ' active' : ''}`}
            onClick={() => onPreset(secs)}
          >
            {secs < 60 ? `${secs}s` : `${secs / 60}m`}
          </button>
        ))}
      </div>
    </div>
  )
}
