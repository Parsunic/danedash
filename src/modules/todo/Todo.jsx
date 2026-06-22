import { useState, useEffect, useRef, useCallback } from 'react'
import { storeGet, storeSet, storeDelete, storeListKeys } from '../../lib/storage.js'
import { isAudioEnabled, playDing } from '../../lib/audio.js'
import { getActiveDateString, getTomorrowDateString, formatDate } from '../../lib/dateHelpers.js'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'

const BURST_COLORS = ['#E8A020', '#6BE3A4', '#F2C063']
const BURST_COUNT = 14

// ── PARTICLE BURST ──
function ParticleBurst({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 900)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="particle-burst" aria-hidden="true">
      {Array.from({ length: BURST_COUNT }, (_, i) => {
        const angle = (i / BURST_COUNT) * 360 + (Math.random() * (360 / BURST_COUNT))
        const dist = 35 + Math.random() * 55
        const dx = (Math.cos((angle * Math.PI) / 180) * dist).toFixed(1)
        const dy = (Math.sin((angle * Math.PI) / 180) * dist).toFixed(1)
        const size = (3.5 + Math.random() * 4).toFixed(1)
        const delay = Math.floor(Math.random() * 120)
        return (
          <div
            key={i}
            className="particle"
            style={{
              '--dx': dx + 'px',
              '--dy': dy + 'px',
              width: size + 'px',
              height: size + 'px',
              background: BURST_COLORS[i % BURST_COLORS.length],
              animationDelay: delay + 'ms',
            }}
          />
        )
      })}
    </div>
  )
}

// ── STREAK ──
function computeStreak() {
  const activeDate = getActiveDateString()
  const streakData = storeGet('goal_streak_v1') || { count: 0, lastProcessedDate: null }
  let { count, lastProcessedDate } = streakData
  const allKeys = storeListKeys('goals:').filter(k => k.slice(6) < activeDate).sort()
  for (const key of allKeys) {
    const dateStr = key.slice(6)
    if (lastProcessedDate && dateStr <= lastProcessedDate) continue
    const goals = storeGet(key) || []
    if (goals.length === 0) { lastProcessedDate = dateStr; continue }
    count = goals.every(g => g.done) ? count + 1 : 0
    lastProcessedDate = dateStr
  }
  storeSet('goal_streak_v1', { count, lastProcessedDate })
  return count
}

// ── GOAL ROW ──
function GoalRow({ goal, index, goals, goalKey, readOnly, hasFinePointer, onGoalsChange }) {
  const liRef = useRef(null)
  const textRef = useRef(null)
  const originalTextRef = useRef('')
  const isEditingRef = useRef(false)
  const [cbPopping, setCbPopping] = useState(false)

  useEffect(() => {
    const el = textRef.current
    if (el && !isEditingRef.current) el.textContent = goal.text
  }, [goal.text])

  function startEdit() {
    if (readOnly || isEditingRef.current) return
    const el = textRef.current
    isEditingRef.current = true
    originalTextRef.current = el.textContent
    el.contentEditable = 'true'
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
  }

  function commitEdit() {
    const el = textRef.current
    if (!el || !isEditingRef.current) return
    isEditingRef.current = false
    const newText = el.textContent.trim()
    el.contentEditable = 'false'
    if (newText && newText !== originalTextRef.current) {
      const newGoals = [...goals]
      newGoals[index] = { ...newGoals[index], text: newText }
      storeSet(goalKey, newGoals)
      onGoalsChange()
    } else {
      el.textContent = originalTextRef.current || goal.text
    }
  }

  function cancelEdit() {
    const el = textRef.current
    if (!el) return
    isEditingRef.current = false
    el.textContent = originalTextRef.current || goal.text
    el.contentEditable = 'false'
  }

  function handleCheck(checked) {
    if (checked) { setCbPopping(true); setTimeout(() => setCbPopping(false), 200) }
    const newGoals = [...goals]
    newGoals[index] = { ...newGoals[index], done: checked }
    if (checked) newGoals[index].doneAt = Date.now()
    else delete newGoals[index].doneAt
    storeSet(goalKey, newGoals)
    onGoalsChange()
  }

  function handleQueueToggle() {
    const newGoals = [...goals]
    newGoals[index] = { ...newGoals[index], queued: !newGoals[index].queued }
    storeSet(goalKey, newGoals)
    if (liRef.current) {
      liRef.current.classList.add('is-queue-flashing')
      setTimeout(() => {
        liRef.current?.classList.remove('is-queue-flashing')
        onGoalsChange()
      }, 480)
    } else {
      onGoalsChange()
    }
  }

  function handleDelete() {
    storeSet(goalKey, goals.filter((_, i) => i !== index))
    onGoalsChange()
  }

  const liCls = [
    'goal-row',
    goal.done && 'goal-row-done',
    goal.queued && !goal.done && 'goal-row-queued',
  ].filter(Boolean).join(' ')

  return (
    <li ref={liRef} className={liCls} data-idx={index} draggable={!readOnly && hasFinePointer}>
      {!readOnly && hasFinePointer && <div className="goal-drag-handle">⋮⋮</div>}
      <label className="goal-cb-wrap">
        <input
          type="checkbox"
          checked={goal.done}
          disabled={readOnly}
          title={readOnly ? 'Read-only' : undefined}
          onChange={e => handleCheck(e.target.checked)}
        />
        <div className={`goal-cb-box${cbPopping ? ' is-popping' : ''}`} />
      </label>
      <div
        ref={textRef}
        className="goal-text"
        suppressContentEditableWarning
        onClick={startEdit}
        onBlur={commitEdit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commitEdit(); textRef.current?.blur() }
          if (e.key === 'Escape') cancelEdit()
        }}
      />
      {!readOnly && (
        <button
          className={`gm-queue-btn${goal.queued ? ' gm-queue-active' : ''}`}
          title="Queue for productivity window"
          onClick={handleQueueToggle}
        >⚡</button>
      )}
      <button className="goal-delete" title="Delete task" onClick={handleDelete}>×</button>
    </li>
  )
}

// ── GOAL LIST (with HTML5 drag + touch drag + cross-list DnD) ──
function GoalList({ goals, goalKey, readOnly, onGoalsChange, onCrossListDrop }) {
  const ulRef = useRef(null)
  const goalsRef = useRef(goals)
  const dragIdxRef = useRef(null)
  const [showAll, setShowAll] = useState(false)
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches

  useEffect(() => { goalsRef.current = goals }, [goals])

  function handleDragStart(e) {
    const li = e.target.closest('[data-idx]')
    if (!li) return
    const idx = parseInt(li.dataset.idx)
    dragIdxRef.current = idx
    e.dataTransfer.effectAllowed = 'move'
    const task = goalsRef.current[idx]
    if (task) {
      e.dataTransfer.setData('application/x-task', JSON.stringify({ task, sourceKey: goalKey }))
    }
  }

  function handleDragOver(e) {
    e.preventDefault()
    const li = e.target.closest('[data-idx]')
    ulRef.current?.querySelectorAll('[data-idx]').forEach(r => r.classList.remove('drag-over'))
    if (li) li.classList.add('drag-over')
  }

  function handleDragLeave(e) {
    if (!ulRef.current?.contains(e.relatedTarget)) {
      ulRef.current?.querySelectorAll('[data-idx]').forEach(r => r.classList.remove('drag-over'))
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    ulRef.current?.querySelectorAll('[data-idx]').forEach(r => r.classList.remove('drag-over'))

    // Cross-list drop check
    const rawData = e.dataTransfer.getData('application/x-task')
    if (rawData) {
      try {
        const { task, sourceKey } = JSON.parse(rawData)
        if (sourceKey !== goalKey) {
          onCrossListDrop?.(task, sourceKey)
          dragIdxRef.current = null
          return
        }
      } catch {}
    }

    // Same-list reorder
    const li = e.target.closest('[data-idx]')
    if (!li || dragIdxRef.current === null) return
    const toIdx = parseInt(li.dataset.idx)
    if (toIdx === dragIdxRef.current) return
    const newGoals = [...goalsRef.current]
    const [moved] = newGoals.splice(dragIdxRef.current, 1)
    newGoals.splice(toIdx, 0, moved)
    storeSet(goalKey, newGoals)
    onGoalsChange()
    dragIdxRef.current = null
  }

  // Touch drag (mobile, press-and-hold 450ms)
  useEffect(() => {
    const ul = ulRef.current
    if (!ul || readOnly || hasFinePointer) return

    let dragState = null
    let longPressTimer = null

    function beginDrag(li, touchY) {
      const rect = li.getBoundingClientRect()
      const idx = parseInt(li.dataset.idx)
      if (navigator.vibrate) navigator.vibrate(25)
      const placeholder = document.createElement('li')
      placeholder.className = 'goal-row touch-drag-placeholder'
      placeholder.style.height = rect.height + 'px'
      ul.insertBefore(placeholder, li)
      li.classList.add('is-touch-dragging')
      li.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;z-index:500;pointer-events:none;margin:0;`
      dragState = { li, idx, placeholder }
    }

    function moveDrag(touchY) {
      if (!dragState) return
      const { li, placeholder } = dragState
      li.style.top = (touchY - li.offsetHeight / 2) + 'px'
      const rows = [...ul.querySelectorAll('[data-idx]:not(.is-touch-dragging):not(.touch-drag-placeholder)')]
      let insertBefore = null
      for (const row of rows) {
        const r = row.getBoundingClientRect()
        if (touchY < r.top + r.height / 2) { insertBefore = row; break }
      }
      const showMoreBtn = ul.querySelector('.show-more-btn')
      if (insertBefore) ul.insertBefore(placeholder, insertBefore)
      else if (showMoreBtn) ul.insertBefore(placeholder, showMoreBtn)
      else ul.appendChild(placeholder)
    }

    function endDrag() {
      if (!dragState) return
      const { li, idx, placeholder } = dragState
      const phPos = [...ul.children].indexOf(placeholder)
      const toIdx = [...ul.children].slice(0, phPos)
        .filter(el => el.dataset.idx !== undefined
          && !el.classList.contains('touch-drag-placeholder')
          && !el.classList.contains('is-touch-dragging')
        ).length
      li.style.cssText = ''
      li.classList.remove('is-touch-dragging')
      placeholder.remove()
      dragState = null
      if (toIdx !== idx) {
        const newGoals = [...goalsRef.current]
        const [moved] = newGoals.splice(idx, 1)
        newGoals.splice(toIdx, 0, moved)
        storeSet(goalKey, newGoals)
      }
      onGoalsChange()
    }

    function cancelDrag() {
      if (!dragState) return
      dragState.li.style.cssText = ''
      dragState.li.classList.remove('is-touch-dragging')
      if (dragState.placeholder.parentNode) dragState.placeholder.remove()
      dragState = null
    }

    function onTouchStart(e) {
      const li = e.target.closest('[data-idx]')
      if (!li || li.classList.contains('touch-drag-placeholder')) return
      const touch = e.touches[0]
      longPressTimer = setTimeout(() => beginDrag(li, touch.clientY), 450)
    }
    function onTouchMove(e) {
      if (longPressTimer && !dragState) { clearTimeout(longPressTimer); longPressTimer = null; return }
      if (!dragState) return
      e.preventDefault()
      moveDrag(e.touches[0].clientY)
    }
    function onTouchEnd() {
      clearTimeout(longPressTimer); longPressTimer = null
      if (dragState) endDrag()
    }
    function onTouchCancel() {
      clearTimeout(longPressTimer); longPressTimer = null
      cancelDrag()
    }

    ul.addEventListener('touchstart', onTouchStart, { passive: true })
    ul.addEventListener('touchmove', onTouchMove, { passive: false })
    ul.addEventListener('touchend', onTouchEnd)
    ul.addEventListener('touchcancel', onTouchCancel)
    return () => {
      ul.removeEventListener('touchstart', onTouchStart)
      ul.removeEventListener('touchmove', onTouchMove)
      ul.removeEventListener('touchend', onTouchEnd)
      ul.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [goalKey, readOnly, hasFinePointer, onGoalsChange])

  const LIMIT = 5
  const visibleGoals = showAll ? goals : goals.slice(0, LIMIT)

  return (
    <ul
      ref={ulRef}
      className="goal-list"
      onDragStart={!readOnly && hasFinePointer ? handleDragStart : undefined}
      onDragOver={hasFinePointer ? handleDragOver : undefined}
      onDragLeave={hasFinePointer ? handleDragLeave : undefined}
      onDrop={hasFinePointer ? handleDrop : undefined}
    >
      {visibleGoals.map((g, i) => (
        <GoalRow
          key={i}
          goal={g}
          index={i}
          goals={goals}
          goalKey={goalKey}
          readOnly={readOnly}
          hasFinePointer={hasFinePointer}
          onGoalsChange={onGoalsChange}
        />
      ))}
      {!showAll && goals.length > LIMIT && (
        <button className="show-more-btn" onClick={() => setShowAll(true)}>
          Show {goals.length - LIMIT} more ▾
        </button>
      )}
      {showAll && goals.length > LIMIT && (
        <button className="show-more-btn" onClick={() => setShowAll(false)}>
          Show less ▴
        </button>
      )}
    </ul>
  )
}

// ── ADD GOAL FORM ──
function AddGoalForm({ goalKey, placeholder, onGoalsChange }) {
  const [inputVal, setInputVal] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [statusErr, setStatusErr] = useState(false)
  const [polishing, setPolishing] = useState(false)

  function showStatus(msg, isErr) {
    setStatusMsg(msg); setStatusErr(isErr)
    setTimeout(() => { setStatusMsg(''); setStatusErr(false) }, 3500)
  }

  function addGoal(text) {
    const trimmed = text.trim()
    if (!trimmed) return
    const goals = storeGet(goalKey) || []
    goals.push({ id: crypto.randomUUID(), text: trimmed, done: false })
    storeSet(goalKey, goals)
    setInputVal('')
    onGoalsChange()
  }

  async function handlePolish() {
    const raw = inputVal.trim()
    if (!raw) return
    const apiKey = localStorage.getItem('anthropic_api_key') || ''
    if (!apiKey) { addGoal(raw); showStatus('Polish needs an Anthropic API key — added as-typed.', false); return }
    setPolishing(true)
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content: `Clean up and improve this goal into a clear, actionable one-liner. Return ONLY a one-element JSON array of strings with no preamble, no code fences, just the array. Goal: "${raw}"` }],
        }),
      })
      const data = await resp.json()
      const arr = JSON.parse(data.content[0].text.trim())
      addGoal(arr[0])
    } catch {
      addGoal(raw)
      showStatus('Polish failed — added as-typed.', true)
    } finally {
      setPolishing(false)
    }
  }

  return (
    <>
      <div className="gm-input-wrap">
        <input
          type="text"
          value={inputVal}
          placeholder={placeholder}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addGoal(inputVal)}
        />
        <button className="btn-primary" onClick={() => addGoal(inputVal)}>+ Add</button>
        <button className="btn-ghost" disabled={polishing} onClick={handlePolish}>
          {polishing ? '…' : '✨ Polish'}
        </button>
      </div>
      {statusMsg && <div className={`polish-status${statusErr ? ' error' : ''}`}>{statusMsg}</div>}
    </>
  )
}

// ── TODAY CARD ──
function TodayCard({ goals, goalKey, streak, onGoalsChange, onCrossListDrop }) {
  const activeDate = getActiveDateString()
  const tomorrowKey = 'goals:' + getTomorrowDateString()
  const done = goals.filter(g => g.done).length
  const total = goals.length
  const allDone = total > 0 && done === total
  const hasPending = goals.some(g => !g.done)
  const [showBurst, setShowBurst] = useState(false)
  const prevAllDoneRef = useRef(false)

  useEffect(() => {
    if (allDone && !prevAllDoneRef.current && total > 0) {
      setShowBurst(true)
      if (isAudioEnabled()) playDing()
    }
    prevAllDoneRef.current = allDone
  }, [allDone, total])

  let progressLabel = 'no tasks yet'
  if (total > 0 && allDone) progressLabel = 'all done — solid day'
  else if (total > 0) progressLabel = 'complete'

  function handlePushRemaining() {
    if (!confirm('Push all unchecked tasks to tomorrow?')) return
    const tomorrowGoals = storeGet(tomorrowKey) || []
    const existingTexts = new Set(tomorrowGoals.map(g => g.text))
    goals.filter(g => !g.done).forEach(g => {
      if (!existingTexts.has(g.text)) { tomorrowGoals.push({ id: crypto.randomUUID(), text: g.text, done: false }); existingTexts.add(g.text) }
    })
    storeSet(goalKey, goals.filter(g => g.done))
    storeSet(tomorrowKey, tomorrowGoals)
    onGoalsChange()
  }

  return (
    <div className={`gm-card${allDone ? ' gm-all-done' : ''}`}>
      <div className="gm-card-header">
        <div className="gm-header-left">
          <div className="gm-eyebrow">Today — {formatDate(activeDate)}</div>
          <div className="gm-progress-row">
            <div className="gm-progress-num">{done}</div>
            <div className="gm-progress-total">/ {total}</div>
            <div className="gm-progress-label">{progressLabel}</div>
          </div>
        </div>
        <div className={`gm-streak${streak > 0 ? ' gm-streak-active' : ''}`}>
          <span className="gm-streak-icon">⚡</span>
          <span className="gm-streak-num">{streak}</span>
          <span className="gm-streak-label">day streak</span>
        </div>
      </div>
      <div className="gm-bar" style={{ position: 'relative' }}>
        {goals.map((g, i) => (
          <div key={i} className={`gm-bar-seg${g.done ? ' gm-bar-seg-done' : ''}`} />
        ))}
        {showBurst && <ParticleBurst onDone={() => setShowBurst(false)} />}
      </div>
      {goals.length === 0 && (
        <div className="empty-state">No tasks for today yet — add one below.</div>
      )}
      <GoalList goals={goals} goalKey={goalKey} readOnly={false} onGoalsChange={onGoalsChange} onCrossListDrop={onCrossListDrop} />
      {hasPending && (
        <button className="btn-ghost" style={{ width: '100%' }} onClick={handlePushRemaining}>
          → Push remaining to tomorrow
        </button>
      )}
      <AddGoalForm goalKey={goalKey} placeholder="Add a task for today…" onGoalsChange={onGoalsChange} />
    </div>
  )
}

// ── TOMORROW CARD ──
function TomorrowCard({ goals, goalKey, onGoalsChange, onCrossListDrop }) {
  const tomorrowDate = getTomorrowDateString()
  return (
    <div className="gm-card gm-card-tomorrow">
      <div className="gm-card-header">
        <div className="gm-header-left">
          <div className="gm-eyebrow">Plan tomorrow — {formatDate(tomorrowDate)}</div>
          <div className="gm-tomorrow-sub">Set your intentions for the day ahead.</div>
        </div>
        <div className="gm-tomorrow-count">{goals.filter(g => !g.done).length} planned</div>
      </div>
      {goals.length === 0 && (
        <div className="empty-state">Nothing planned for tomorrow yet.</div>
      )}
      <GoalList goals={goals} goalKey={goalKey} readOnly={false} onGoalsChange={onGoalsChange} onCrossListDrop={onCrossListDrop} />
      <AddGoalForm goalKey={goalKey} placeholder="Add a task for tomorrow…" onGoalsChange={onGoalsChange} />
    </div>
  )
}

// ── GENERAL CARD ──
function GeneralCard({ goals, goalKey, onGoalsChange, onCrossListDrop }) {
  const open = goals.filter(g => !g.done).length
  return (
    <div className="gm-card gm-card-general">
      <div className="gm-card-header">
        <div className="gm-header-left">
          <div className="gm-eyebrow">General</div>
          <div className="gm-tomorrow-sub">Tasks without a specific date.</div>
        </div>
        <div className="gm-tomorrow-count">{open} open</div>
      </div>
      {goals.length === 0 && (
        <div className="empty-state">Drag tasks here or add your own.</div>
      )}
      <GoalList goals={goals} goalKey={goalKey} readOnly={false} onGoalsChange={onGoalsChange} onCrossListDrop={onCrossListDrop} />
      <AddGoalForm goalKey={goalKey} placeholder="Add a general task…" onGoalsChange={onGoalsChange} />
    </div>
  )
}

// ── TODO ROOT ──
export default function Todo({ embedded = false }) {
  const activeDateRef = useRef(getActiveDateString())
  const tomorrowDateRef = useRef(getTomorrowDateString())
  const generalKey = 'general_tasks'

  const [todayGoals, setTodayGoals] = useState(() => storeGet('goals:' + activeDateRef.current) || [])
  const [tomorrowGoals, setTomorrowGoals] = useState(() => storeGet('goals:' + tomorrowDateRef.current) || [])
  const [generalTasks, setGeneralTasks] = useState(() => storeGet(generalKey) || [])
  const [streak, setStreak] = useState(0)

  const reload = useCallback(() => {
    setTodayGoals(storeGet('goals:' + activeDateRef.current) || [])
    setTomorrowGoals(storeGet('goals:' + tomorrowDateRef.current) || [])
    setGeneralTasks(storeGet(generalKey) || [])
    setStreak(computeStreak())
  }, [])

  useEffect(() => {
    reload()
    window.addEventListener('goals-changed', reload)
    return () => window.removeEventListener('goals-changed', reload)
  }, [reload])

  const todayKey = 'goals:' + activeDateRef.current
  const tomorrowKey = 'goals:' + tomorrowDateRef.current

  function moveTask(task, fromKey, toKey) {
    if (fromKey === toKey) return
    const movedTask = task.id ? task : { ...task, id: crypto.randomUUID() }
    const from = storeGet(fromKey) || []
    const filtered = task.id
      ? from.filter(t => t.id !== task.id)
      : from.filter(t => t.text !== task.text)
    storeSet(fromKey, filtered)
    const to = storeGet(toKey) || []
    if (!to.some(t => t.id && t.id === movedTask.id)) {
      storeSet(toKey, [...to, movedTask])
    }
    reload()
  }

  const content = (
    <div className="todo-desktop-grid stagger-1">
      <TodayCard
        goals={todayGoals}
        goalKey={todayKey}
        streak={streak}
        onGoalsChange={reload}
        onCrossListDrop={(task, fromKey) => moveTask(task, fromKey, todayKey)}
      />
      <TomorrowCard
        goals={tomorrowGoals}
        goalKey={tomorrowKey}
        onGoalsChange={reload}
        onCrossListDrop={(task, fromKey) => moveTask(task, fromKey, tomorrowKey)}
      />
      <GeneralCard
        goals={generalTasks}
        goalKey={generalKey}
        onGoalsChange={reload}
        onCrossListDrop={(task, fromKey) => moveTask(task, fromKey, generalKey)}
      />
    </div>
  )

  if (embedded) return content

  return (
    <div className="section">
      <BackgroundBlob page="todo" />
      <div className="section-title">To Do List</div>
      {content}
    </div>
  )
}
