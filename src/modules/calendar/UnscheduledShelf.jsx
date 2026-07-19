import { useState, useEffect, useMemo } from 'react'
import { useUIEdit } from '../../contexts/UIEditContext.jsx'
import { getDayEvents } from './calendarUtils.js'
import { getUnscheduledTasks, suggestPlacements } from './timeboxUtils.js'

const isDesktop = window.matchMedia('(min-width: 1024px)').matches

// ── F5 Task Timeboxing — "Unscheduled" shelf ──
// Quiet strip above the time grid (day + week views) listing today's undone
// goals. Desktop: drag a chip onto the grid. Mobile: tap a chip to arm
// placement mode, then tap a slot. "Suggest slots" packs everything into
// today's free windows via the existing event-creation path.
export default function UnscheduledShelf({
  events,
  gymPlanned,
  view,
  viewDate,
  armedTask,
  onArmTask,
  onEventsAdd,
}) {
  const { editing } = useUIEdit()
  const [collapsed, setCollapsed] = useState(!isDesktop) // per-session only
  const [tick, setTick] = useState(0)
  const [note, setNote] = useState('')

  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener('goals-changed', bump)
    window.addEventListener('sync-applied', bump)
    return () => {
      window.removeEventListener('goals-changed', bump)
      window.removeEventListener('sync-applied', bump)
    }
  }, [])

  const tasks = useMemo(() => getUnscheduledTasks(events), [events, tick])

  // Disarm if edit mode starts or the armed task leaves the shelf
  // (scheduled elsewhere / completed / removed).
  useEffect(() => {
    if (armedTask && (editing || !tasks.some(t => t.id === armedTask.goalId))) {
      onArmTask(null)
    }
  }, [armedTask, tasks, editing, onArmTask])

  // Transient inline note ("no free slots")
  useEffect(() => {
    if (!note) return
    const id = setTimeout(() => setNote(''), 2600)
    return () => clearTimeout(id)
  }, [note])

  if (editing || tasks.length === 0) return null

  const handleChipTap = (task) => {
    if (armedTask && armedTask.goalId === task.id) onArmTask(null)
    else onArmTask({ goalId: task.id, title: task.text })
  }

  const handleDragStart = (e, task) => {
    e.dataTransfer.setData('application/x-timebox', JSON.stringify({ goalId: task.id, title: task.text }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleSuggest = () => {
    const today = new Date()
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const target = view === 'day' && new Date(viewDate) >= startOfToday ? new Date(viewDate) : today

    const dayEvs = getDayEvents(target, events, gymPlanned)
    const placements = suggestPlacements(tasks, dayEvs, target)
    if (!placements.length) {
      setNote('No free slots — the day is full.')
      return
    }
    const stamp = new Date().toISOString()
    onEventsAdd(placements.map(p => ({
      id: crypto.randomUUID(),
      user_id: 'dane',
      title: p.title,
      description: '',
      start_time: p.start_time,
      end_time: p.end_time,
      is_all_day: false,
      module_tag: 'task',
      source_goal_id: p.goalId,
      created_at: stamp,
    })))
  }

  return (
    <div className="tbx-shelf">
      <div className="tbx-head">
        <button className="tbx-label" onClick={() => setCollapsed(c => !c)}>
          <span className="tbx-caret">{collapsed ? '▸' : '▾'}</span>
          Unscheduled · {tasks.length}
        </button>
        {!collapsed && (
          <button className="btn-ghost tbx-suggest" onClick={handleSuggest}>
            Suggest slots
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="tbx-chips">
          {tasks.map(task => (
            <button
              key={task.id}
              className={`tbx-chip${armedTask && armedTask.goalId === task.id ? ' armed' : ''}`}
              draggable={isDesktop}
              onDragStart={e => handleDragStart(e, task)}
              onClick={() => handleChipTap(task)}
              title={task.text}
            >
              {task.queued && <span className="tbx-zap">⚡</span>}
              <span className="tbx-chip-text">{task.text}</span>
            </button>
          ))}
        </div>
      )}
      {armedTask && <div className="tbx-hint">Tap a time slot to place · tap the chip again to cancel</div>}
      {note && <div className="tbx-note">{note}</div>}
    </div>
  )
}
