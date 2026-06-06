import { useState, useEffect, useRef, useCallback } from 'react'
import { storeGet, storeSet, storeListKeys } from '../../lib/storage.js'
import { getActiveDateString, getTomorrowDateString, formatDate, ordinal } from '../../lib/dateHelpers.js'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

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
  // write back without dispatching goals-changed (goal_streak_v1 doesn't start with 'goals:')
  localStorage.setItem('goal_streak_v1', JSON.stringify({ count, lastProcessedDate }))
  window.dispatchEvent(new CustomEvent('schedule-sync'))
  return count
}

// ── GOAL ROW ──
function GoalRow({ goal, index, goals, goalKey, readOnly, hasFinePointer, onGoalsChange }) {
  const liRef = useRef(null)
  const textRef = useRef(null)
  const originalTextRef = useRef('')
  const isEditingRef = useRef(false)

  // Keep text content in sync when goal.text changes from external source
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
          title={readOnly ? 'Activates at 6 AM tomorrow' : undefined}
          onChange={e => handleCheck(e.target.checked)}
        />
        <div className="goal-cb-box" />
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
      <button className="goal-delete" title="Delete goal" onClick={handleDelete}>×</button>
    </li>
  )
}

// ── GOAL LIST (with HTML5 drag + touch drag) ──
function GoalList({ goals, goalKey, readOnly, onGoalsChange }) {
  const ulRef = useRef(null)
  const goalsRef = useRef(goals)
  const dragIdxRef = useRef(null)
  const [showAll, setShowAll] = useState(false)
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches

  useEffect(() => { goalsRef.current = goals }, [goals])

  // HTML5 drag (desktop, pointer: fine)
  function handleDragStart(e) {
    const li = e.target.closest('[data-idx]')
    if (!li) return
    dragIdxRef.current = parseInt(li.dataset.idx)
    e.dataTransfer.effectAllowed = 'move'
  }
  function handleDragOver(e) {
    e.preventDefault()
    const li = e.target.closest('[data-idx]')
    ulRef.current?.querySelectorAll('[data-idx]').forEach(r => r.classList.remove('drag-over'))
    if (li) li.classList.add('drag-over')
  }
  function handleDragLeave() {
    ulRef.current?.querySelectorAll('[data-idx]').forEach(r => r.classList.remove('drag-over'))
  }
  function handleDrop(e) {
    e.preventDefault()
    ulRef.current?.querySelectorAll('[data-idx]').forEach(r => r.classList.remove('drag-over'))
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
      onDragOver={!readOnly && hasFinePointer ? handleDragOver : undefined}
      onDragLeave={!readOnly && hasFinePointer ? handleDragLeave : undefined}
      onDrop={!readOnly && hasFinePointer ? handleDrop : undefined}
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
    goals.push({ text: trimmed, done: false })
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
function TodayCard({ goals, goalKey, streak, onGoalsChange }) {
  const activeDate = getActiveDateString()
  const tomorrowKey = 'goals:' + getTomorrowDateString()
  const done = goals.filter(g => g.done).length
  const total = goals.length
  const allDone = total > 0 && done === total
  const hasPending = goals.some(g => !g.done)

  let progressLabel = 'no goals yet'
  if (total > 0 && allDone) progressLabel = 'all done — solid day'
  else if (total > 0) progressLabel = 'complete'

  function handlePushRemaining() {
    if (!confirm('Push all unchecked goals to tomorrow?')) return
    const tomorrowGoals = storeGet(tomorrowKey) || []
    const existingTexts = new Set(tomorrowGoals.map(g => g.text))
    goals.filter(g => !g.done).forEach(g => {
      if (!existingTexts.has(g.text)) { tomorrowGoals.push({ text: g.text, done: false }); existingTexts.add(g.text) }
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
      <div className="gm-bar">
        {goals.map((g, i) => (
          <div key={i} className={`gm-bar-seg${g.done ? ' gm-bar-seg-done' : ''}`} />
        ))}
      </div>
      {goals.length === 0 && (
        <div className="empty-state">No goals for today yet — add one below.</div>
      )}
      <GoalList goals={goals} goalKey={goalKey} readOnly={false} onGoalsChange={onGoalsChange} />
      {hasPending && (
        <button className="gm-push-btn" onClick={handlePushRemaining}>
          → Push remaining to tomorrow
        </button>
      )}
      <AddGoalForm goalKey={goalKey} placeholder="Add a goal for today…" onGoalsChange={onGoalsChange} />
    </div>
  )
}

// ── TOMORROW CARD ──
function TomorrowCard({ goals, goalKey, onGoalsChange }) {
  const tomorrowDate = getTomorrowDateString()
  return (
    <div className="gm-card gm-card-tomorrow">
      <div className="gm-card-header">
        <div className="gm-header-left">
          <div className="gm-eyebrow">Plan tomorrow — {formatDate(tomorrowDate)}</div>
          <div className="gm-tomorrow-sub">Write tonight, locked until 6 AM.</div>
        </div>
        <div className="gm-tomorrow-count">{goals.length} planned</div>
      </div>
      {goals.length === 0 && (
        <div className="empty-state">Nothing planned for tomorrow yet.</div>
      )}
      <GoalList goals={goals} goalKey={goalKey} readOnly={true} onGoalsChange={onGoalsChange} />
      <AddGoalForm goalKey={goalKey} placeholder="Add a goal for tomorrow…" onGoalsChange={onGoalsChange} />
    </div>
  )
}

// ── RECURRING SECTION ──
function RecurringSection() {
  const [recurring, setRecurring] = useState(() => storeGet('recurring_tasks') || [])
  const [isOpen, setIsOpen] = useState(() => localStorage.getItem('ui_recurring_open') === 'true')
  const [selectedFreq, setSelectedFreq] = useState('daily')
  const [selectedDays, setSelectedDays] = useState([])
  const [inputVal, setInputVal] = useState('')

  useEffect(() => {
    const handler = () => setRecurring(storeGet('recurring_tasks') || [])
    window.addEventListener('goals-changed', handler)
    return () => window.removeEventListener('goals-changed', handler)
  }, [])

  function toggleOpen() {
    const next = !isOpen
    setIsOpen(next)
    localStorage.setItem('ui_recurring_open', String(next))
  }

  function toggleDay(day) {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  function handleFreqChange(freq) {
    setSelectedFreq(freq)
    setSelectedDays([])
  }

  function freqLabel(task) {
    if (task.freq === 'daily') return 'Daily'
    if (task.freq === 'weekly') {
      if (!task.days?.length) return 'Weekly'
      return task.days.slice().sort((a, b) => a - b).map(d => DAY_NAMES[d]).join(' · ')
    }
    if (task.freq === 'monthly') {
      if (!task.days?.length) return 'Monthly'
      return task.days.slice().sort((a, b) => a - b).map(d => ordinal(d)).join(', ')
    }
    return task.freq
  }

  function freqClass(freq) {
    if (freq === 'weekly') return 'recurring-badge freq-weekly'
    if (freq === 'monthly') return 'recurring-badge freq-monthly'
    return 'recurring-badge'
  }

  function handleAdd() {
    const text = inputVal.trim()
    if (!text) return
    const tasks = [...recurring, { id: Date.now(), text, freq: selectedFreq, days: [...selectedDays] }]
    storeSet('recurring_tasks', tasks)
    setRecurring(tasks)
    setInputVal('')
    setSelectedDays([])
  }

  function handleDelete(idx) {
    const tasks = recurring.filter((_, i) => i !== idx)
    storeSet('recurring_tasks', tasks)
    setRecurring(tasks)
  }

  function handleEditText(idx, newText) {
    if (!newText.trim()) return
    const tasks = recurring.map((t, i) => i === idx ? { ...t, text: newText.trim() } : t)
    storeSet('recurring_tasks', tasks)
    setRecurring(tasks)
  }

  return (
    <div className="section">
      <div className="section-title">
        <button className="recurring-toggle" onClick={toggleOpen}>
          Recurring
          <span className="recurring-count-badge">{recurring.length > 0 ? String(recurring.length) : ''}</span>
          <span className={`recurring-chevron${isOpen ? ' open' : ''}`}>▸</span>
        </button>
      </div>
      <div className={`recurring-section-body${isOpen ? ' open' : ''}`}>
        <div className="gm-card" style={{}}>
          <ul className="goal-list">
            {recurring.map((task, idx) => (
              <RecurringRow
                key={task.id}
                task={task}
                freqLabel={freqLabel(task)}
                freqClass={freqClass(task.freq)}
                onDelete={() => handleDelete(idx)}
                onEditText={newText => handleEditText(idx, newText)}
              />
            ))}
          </ul>
          {recurring.length === 0 && (
            <div className="empty-state">No recurring tasks yet — add one below.</div>
          )}
          <div className="recurring-form">
            <input
              type="text"
              className="recurring-text-input"
              placeholder="Add a recurring task…"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <div className="freq-tabs">
              {['daily', 'weekly', 'monthly'].map(freq => (
                <button
                  key={freq}
                  className={`freq-tab${selectedFreq === freq ? ' active' : ''}`}
                  onClick={() => handleFreqChange(freq)}
                >
                  {freq.charAt(0).toUpperCase() + freq.slice(1)}
                </button>
              ))}
            </div>
            {selectedFreq === 'weekly' && (
              <div className="day-picker-wrap">
                {DAY_NAMES.map((name, i) => (
                  <button
                    key={i}
                    className={`day-toggle${selectedDays.includes(i) ? ' active' : ''}`}
                    onClick={() => toggleDay(i)}
                  >{name}</button>
                ))}
              </div>
            )}
            {selectedFreq === 'monthly' && (
              <div className="day-picker-wrap">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <button
                    key={d}
                    className={`day-toggle month-toggle${selectedDays.includes(d) ? ' active' : ''}`}
                    onClick={() => toggleDay(d)}
                  >{d}</button>
                ))}
              </div>
            )}
            <button className="btn-recurring-add" onClick={handleAdd}>
              + Add Recurring Task
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RecurringRow({ task, freqLabel, freqClass, onDelete, onEditText }) {
  const textRef = useRef(null)
  const originalRef = useRef('')
  const isEditingRef = useRef(false)

  useEffect(() => {
    const el = textRef.current
    if (el && !isEditingRef.current) el.textContent = task.text
  }, [task.text])

  function startEdit() {
    const el = textRef.current
    isEditingRef.current = true
    originalRef.current = el.textContent
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
    if (newText && newText !== originalRef.current) onEditText(newText)
    else el.textContent = originalRef.current
  }

  return (
    <li className="goal-row">
      <div
        ref={textRef}
        className="goal-text"
        suppressContentEditableWarning
        onClick={startEdit}
        onBlur={commitEdit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commitEdit(); textRef.current?.blur() }
          if (e.key === 'Escape') { textRef.current.textContent = originalRef.current; textRef.current.contentEditable = 'false'; isEditingRef.current = false }
        }}
      />
      <div className={freqClass}>{freqLabel}</div>
      <button className="goal-delete" title="Delete recurring task" onClick={onDelete}>×</button>
    </li>
  )
}

// ── TODO ROOT ──
export default function Todo() {
  const activeDateRef = useRef(getActiveDateString())
  const tomorrowDateRef = useRef(getTomorrowDateString())

  const [todayGoals, setTodayGoals] = useState(() => storeGet('goals:' + activeDateRef.current) || [])
  const [tomorrowGoals, setTomorrowGoals] = useState(() => storeGet('goals:' + tomorrowDateRef.current) || [])
  const [streak, setStreak] = useState(0)

  const reload = useCallback(() => {
    setTodayGoals(storeGet('goals:' + activeDateRef.current) || [])
    setTomorrowGoals(storeGet('goals:' + tomorrowDateRef.current) || [])
    setStreak(computeStreak())
  }, [])

  useEffect(() => {
    reload()
    window.addEventListener('goals-changed', reload)
    return () => window.removeEventListener('goals-changed', reload)
  }, [reload])

  const todayKey = 'goals:' + activeDateRef.current
  const tomorrowKey = 'goals:' + tomorrowDateRef.current

  return (
    <div className="section">
      <BackgroundBlob page="todo" />
      <div className="section-title">To Do List</div>
      <div className="todo-desktop-grid">
        <TodayCard
          goals={todayGoals}
          goalKey={todayKey}
          streak={streak}
          onGoalsChange={reload}
        />
        <TomorrowCard
          goals={tomorrowGoals}
          goalKey={tomorrowKey}
          onGoalsChange={reload}
        />
      </div>
      <RecurringSection />
    </div>
  )
}
