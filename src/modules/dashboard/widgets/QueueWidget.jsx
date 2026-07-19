import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { storeGet, storeSet } from '../../../lib/storage.js'
import { getActiveDateString } from '../../../lib/dateHelpers.js'

// Queue widget — copied from Dashboard.jsx TopTasksWidget.
// S: big remaining-count + "left today" + top task one-liner.
// M: today's 2 chips (queued-first, exactly today's behavior).
// L: up to 5 chips + done/total progress line + micro-copy.
// Each chip's leading circle is a tap target — mark that goal done (mirrors
// Todo.jsx handleCheck: { ...goal, done: true, doneAt: Date.now() } via storeSet).

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const ONE_LINE = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

function microCopy(done, total) {
  if (total === 0) return 'Nothing on the list yet.'
  if (done === total) return 'All done. Solid day.'
  if (done === 0) return "First one's the hardest — go."
  return "One down. Don't stop now."
}

// Ordinal of `t` among id-less goals in `list` (reference match). -1 if not found.
function idlessOrdinal(list, t) {
  let ord = -1
  for (const g of list) {
    if (g.id == null) { ord++; if (g === t) return ord }
  }
  return -1
}

// Leading check control — the chip's circle/bolt, now tappable to mark done.
function TaskCheck({ queued, done, onClick }) {
  return (
    <button
      type="button"
      className={`dash-task-bullet dash-task-check${queued ? ' is-queued' : ''}${done ? ' is-done' : ''}`}
      aria-label={done ? 'Task completed' : 'Mark done'}
      onClick={onClick}
    >
      {done ? '✓' : (queued ? '⚡' : '○')}
    </button>
  )
}

export default function QueueWidget({ size, bp }) {
  const [goals, setGoals] = useState([])
  // Chips mid-completion: show the done state + slide-out before the re-read drops them.
  const [completing, setCompleting] = useState(() => new Set())

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

  // Stable per-task key: by id when present, else (ordinal-among-id-less + text).
  const chipKeyFor = (t) =>
    t.id != null ? 'id:' + t.id : 'legacy:' + idlessOrdinal(goals, t) + ':' + t.text

  // One gesture → one write. Show the completing state, then (after the ~300ms
  // animation) read fresh, locate the exact row, set done, and storeSet — which
  // stamps _lastLocalChange, dispatches goals-changed, and schedules a sync push.
  function completeTask(t) {
    const cKey = chipKeyFor(t)
    if (completing.has(cKey)) return
    const dayKey = 'goals:' + getActiveDateString()
    const matchKey = t.id != null
      ? { id: t.id }
      : { text: t.text, idlessIdx: idlessOrdinal(goals, t) }
    setCompleting(prev => { const s = new Set(prev); s.add(cKey); return s })
    setTimeout(() => {
      const fresh = storeGet(dayKey) || []
      let i = -1
      if (matchKey.id != null) {
        i = fresh.findIndex(g => g.id === matchKey.id)
      } else {
        // Legacy id-less: nth id-less row AND matching text — never the wrong row.
        let ord = -1
        for (let k = 0; k < fresh.length; k++) {
          if (fresh[k].id == null) {
            ord++
            if (ord === matchKey.idlessIdx && fresh[k].text === matchKey.text) { i = k; break }
          }
        }
      }
      if (i >= 0 && !fresh[i].done) {
        const next = [...fresh]
        next[i] = { ...next[i], done: true, doneAt: Date.now() }
        storeSet(dayKey, next)
      }
      setCompleting(prev => { const s = new Set(prev); s.delete(cKey); return s })
    }, 320)
  }

  const total = goals.length
  const done = goals.filter(g => g.done).length
  const remaining = total - done
  // Same priority rule as today: queued tasks first when any exist.
  const queued = goals.filter(g => g.queued && !g.done)
  const pendingList = queued.length >= 1 ? queued : goals.filter(g => !g.done)

  // ── S: hero count + top task ──
  if (size === 'S') {
    const top = pendingList[0] || null
    const topDone = top ? completing.has(chipKeyFor(top)) : false
    return (
      <div style={ROOT_STYLE}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 34, lineHeight: 1, color: 'var(--text-primary)' }}>
          {remaining}
        </div>
        <div className="dash-widget-label" style={{ marginTop: 5 }}>left today</div>
        {top ? (
          <div
            className={`dash-s-task${topDone ? ' dash-task-completing' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}
          >
            <TaskCheck queued={top.queued} done={topDone} onClick={() => completeTask(top)} />
            <span className="dash-task-text" style={ONE_LINE}>{top.text}</span>
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
        chips.map((t) => {
          const cKey = chipKeyFor(t)
          const isCompleting = completing.has(cKey)
          return (
            <div
              key={cKey}
              className={`dash-task-chip${t.queued ? ' is-queued' : ''}${isCompleting ? ' dash-task-completing' : ''}`}
              style={{ padding: '6px 10px', marginBottom: 6 }}
            >
              <TaskCheck queued={t.queued} done={isCompleting} onClick={() => completeTask(t)} />
              <span className="dash-task-text" style={ONE_LINE}>{t.text}</span>
            </div>
          )
        })
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
