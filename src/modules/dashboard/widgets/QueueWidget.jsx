import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { storeGet } from '../../../lib/storage.js'
import { getActiveDateString } from '../../../lib/dateHelpers.js'

// Queue widget — copied from Dashboard.jsx TopTasksWidget.
// S: big remaining-count + "left today" + top task one-liner.
// M: today's 2 chips (queued-first, exactly today's behavior).
// L: up to 5 chips + done/total progress line + micro-copy.

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const ONE_LINE = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

function microCopy(done, total) {
  if (total === 0) return 'Nothing on the list yet.'
  if (done === total) return 'All done. Solid day.'
  if (done === 0) return "First one's the hardest — go."
  return "One down. Don't stop now."
}

export default function QueueWidget({ size, bp }) {
  const [goals, setGoals] = useState([])

  const load = useCallback(() => {
    setGoals(storeGet('goals:' + getActiveDateString()) || [])
  }, [])

  useEffect(() => {
    load()
    window.addEventListener('goals-changed', load)
    window.addEventListener('sync-applied', load)
    return () => {
      window.removeEventListener('goals-changed', load)
      window.removeEventListener('sync-applied', load)
    }
  }, [load])

  const total = goals.length
  const done = goals.filter(g => g.done).length
  const remaining = total - done
  // Same priority rule as today: queued tasks first when any exist.
  const queued = goals.filter(g => g.queued && !g.done)
  const pendingList = queued.length >= 1 ? queued : goals.filter(g => !g.done)

  // ── S: hero count + top task ──
  if (size === 'S') {
    const top = pendingList[0] || null
    return (
      <div style={ROOT_STYLE}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 34, lineHeight: 1, color: 'var(--text-primary)' }}>
          {remaining}
        </div>
        <div className="dash-widget-label" style={{ marginTop: 5 }}>left today</div>
        {top ? (
          <div className="dash-task-text" style={{ ...ONE_LINE, marginTop: 'auto' }}>
            {top.queued ? '⚡ ' : ''}{top.text}
          </div>
        ) : (
          <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>All clear</div>
        )}
      </div>
    )
  }

  const chipCount = size === 'M' ? 2 : (bp === 'mobile' ? 4 : 5)
  const chips = pendingList.slice(0, chipCount)

  return (
    <div style={ROOT_STYLE}>
      <div className="dash-widget-header" style={{ marginBottom: 8 }}>
        <span className="dash-widget-label">Queue</span>
        <Link to="/goals?view=tasks" className="dash-widget-link">To-Do →</Link>
      </div>
      {chips.length === 0 ? (
        <div className="dash-widget-empty">All clear — nothing queued</div>
      ) : (
        chips.map((t, i) => (
          <div
            key={i}
            className={`dash-task-chip${t.queued ? ' is-queued' : ''}`}
            style={{ padding: '6px 10px', marginBottom: 6 }}
          >
            <span className="dash-task-bullet">{t.queued ? '⚡' : '○'}</span>
            <span className="dash-task-text" style={ONE_LINE}>{t.text}</span>
          </div>
        ))
      )}
      {size === 'L' && (
        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span className="dash-next-time">{done}/{total} done</span>
            <span className="dash-widget-empty" style={{ ...ONE_LINE, padding: 0 }}>{microCopy(done, total)}</span>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', marginTop: 6 }}>
            <div style={{
              height: '100%',
              width: total ? `${(done / total) * 100}%` : 0,
              background: 'var(--accent)',
              borderRadius: 2,
            }} />
          </div>
        </div>
      )}
    </div>
  )
}
