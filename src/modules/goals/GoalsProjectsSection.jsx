import { useState, useEffect } from 'react'
import { storeGet, storeSet } from '../../lib/storage.js'
import { getActiveDateString } from '../../lib/dateHelpers.js'

const DOMAINS = [
  { id: 'fitness',   label: 'Fitness',   color: '#E8A020' },
  { id: 'sleep',     label: 'Sleep',     color: '#7048E8' },
  { id: 'mental',    label: 'Mental',    color: '#6BE3A4' },
  { id: 'learning',  label: 'Learning',  color: '#1971C2' },
  { id: 'academics', label: 'Academics', color: '#F2C063' },
  { id: 'other',     label: 'Other',     color: 'rgba(255,255,255,0.4)' },
]

function domainColor(id) {
  return DOMAINS.find(d => d.id === id)?.color ?? 'rgba(255,255,255,0.4)'
}

function getNearestDue(milestones) {
  const dates = milestones.filter(m => !m.done && m.due_date).map(m => m.due_date).sort()
  return dates[0] ?? null
}

function sortGoals(goals) {
  const ORDER = { week: 0, month: 1, quarter: 2 }
  return [...goals].sort((a, b) => {
    const hd = ORDER[a.horizon] - ORDER[b.horizon]
    if (hd !== 0) return hd
    const ad = getNearestDue(a.milestones)
    const bd = getNearestDue(b.milestones)
    if (!ad && !bd) return 0
    if (!ad) return 1
    if (!bd) return -1
    return ad.localeCompare(bd)
  })
}

const HORIZONS = [
  { id: 'week',    label: 'This Week' },
  { id: 'month',   label: 'This Month' },
  { id: 'quarter', label: 'This Quarter' },
]

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5zM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1H11zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5h9.916zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47M8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5z"/>
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
    </svg>
  )
}

export default function GoalsProjectsSection() {
  const [goals, setGoals] = useState(() => storeGet('goals_projects') || [])
  const [filter, setFilter] = useState('active')

  // Re-read from localStorage when a remote sync applies data
  useEffect(() => {
    function onSync() { setGoals(storeGet('goals_projects') || []) }
    window.addEventListener('sync-applied', onSync)
    return () => window.removeEventListener('sync-applied', onSync)
  }, [])
  const [expanded, setExpanded] = useState(() => new Set())
  const [expandedMilestones, setExpandedMilestones] = useState(() => new Set())
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const [showAddGoal, setShowAddGoal] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formDomain, setFormDomain] = useState('fitness')
  const [formHorizon, setFormHorizon] = useState('month')
  const [formNotes, setFormNotes] = useState('')

  const [addMilestoneFor, setAddMilestoneFor] = useState(null)
  const [milestoneText, setMilestoneText] = useState('')
  const [milestoneDue, setMilestoneDue] = useState('')

  const [addCheckpointFor, setAddCheckpointFor] = useState(null) // { goalId, milestoneId }
  const [checkpointText, setCheckpointText] = useState('')

  const [editing, setEditing] = useState(null) // { type, goalId, milestoneId?, checkpointId?, text }

  function saveGoals(next) {
    setGoals(next)
    storeSet('goals_projects', next)
  }

  function addGoal() {
    if (!formTitle.trim()) return
    const next = [
      ...goals,
      {
        id: crypto.randomUUID(),
        title: formTitle.trim(),
        domain: formDomain,
        horizon: formHorizon,
        milestones: [],
        ...(formNotes.trim() ? { notes: formNotes.trim() } : {}),
        created_at: new Date().toISOString(),
      },
    ]
    saveGoals(next)
    setShowAddGoal(false)
    setFormTitle('')
    setFormDomain('fitness')
    setFormHorizon('month')
    setFormNotes('')
  }

  function deleteGoal(id) {
    saveGoals(goals.filter(g => g.id !== id))
    setDeleteConfirm(null)
    setExpanded(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  function toggleExpanded(id) {
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function toggleMilestoneExpanded(milestoneId) {
    setExpandedMilestones(prev => {
      const n = new Set(prev)
      if (n.has(milestoneId)) n.delete(milestoneId)
      else n.add(milestoneId)
      return n
    })
  }

  function addMilestone(goalId) {
    if (!milestoneText.trim()) return
    const next = goals.map(g => g.id !== goalId ? g : {
      ...g,
      milestones: [
        ...g.milestones,
        {
          id: crypto.randomUUID(),
          text: milestoneText.trim(),
          ...(milestoneDue ? { due_date: milestoneDue } : {}),
          done: false,
          checkpoints: [],
        },
      ],
    })
    saveGoals(next)
    setAddMilestoneFor(null)
    setMilestoneText('')
    setMilestoneDue('')
  }

  function deleteMilestone(goalId, milestoneId) {
    saveGoals(goals.map(g => g.id !== goalId ? g : {
      ...g,
      milestones: g.milestones.filter(m => m.id !== milestoneId),
    }))
    setExpandedMilestones(prev => { const n = new Set(prev); n.delete(milestoneId); return n })
  }

  function toggleMilestone(goalId, milestoneId) {
    saveGoals(goals.map(g => g.id !== goalId ? g : {
      ...g,
      milestones: g.milestones.map(m => m.id !== milestoneId ? m : { ...m, done: !m.done }),
    }))
  }

  function addCheckpoint(goalId, milestoneId) {
    if (!checkpointText.trim()) return
    saveGoals(goals.map(g => g.id !== goalId ? g : {
      ...g,
      milestones: g.milestones.map(m => m.id !== milestoneId ? m : {
        ...m,
        checkpoints: [
          ...(m.checkpoints || []),
          { id: crypto.randomUUID(), text: checkpointText.trim(), done: false },
        ],
      }),
    }))
    setAddCheckpointFor(null)
    setCheckpointText('')
  }

  function toggleCheckpoint(goalId, milestoneId, checkpointId) {
    saveGoals(goals.map(g => g.id !== goalId ? g : {
      ...g,
      milestones: g.milestones.map(m => m.id !== milestoneId ? m : {
        ...m,
        checkpoints: (m.checkpoints || []).map(c =>
          c.id !== checkpointId ? c : { ...c, done: !c.done }
        ),
      }),
    }))
  }

  function deleteCheckpoint(goalId, milestoneId, checkpointId) {
    saveGoals(goals.map(g => g.id !== goalId ? g : {
      ...g,
      milestones: g.milestones.map(m => m.id !== milestoneId ? m : {
        ...m,
        checkpoints: (m.checkpoints || []).filter(c => c.id !== checkpointId),
      }),
    }))
  }

  function pushToToday(goalId, milestoneId, checkpointId) {
    const activeDate = getActiveDateString()
    const goal = goals.find(g => g.id === goalId)
    const milestone = goal.milestones.find(m => m.id === milestoneId)
    const checkpoint = milestone.checkpoints.find(c => c.id === checkpointId)
    const tasks = storeGet(`goals:${activeDate}`) || []
    tasks.push({
      id: crypto.randomUUID(),
      text: checkpoint.text,
      done: false,
      date: activeDate,
      source_checkpoint_id: checkpoint.id,
    })
    storeSet(`goals:${activeDate}`, tasks)
    saveGoals(goals.map(g => g.id !== goalId ? g : {
      ...g,
      milestones: g.milestones.map(m => m.id !== milestoneId ? m : {
        ...m,
        checkpoints: m.checkpoints.map(c =>
          c.id !== checkpointId ? c : { ...c, pushed_to_date: activeDate }
        ),
      }),
    }))
  }

  function saveEdit() {
    if (!editing || !editing.text.trim()) { setEditing(null); return }
    if (editing.type === 'goal') {
      saveGoals(goals.map(g => g.id !== editing.goalId ? g : { ...g, title: editing.text.trim() }))
    } else if (editing.type === 'milestone') {
      saveGoals(goals.map(g => g.id !== editing.goalId ? g : {
        ...g,
        milestones: g.milestones.map(m => m.id !== editing.milestoneId ? m : { ...m, text: editing.text.trim() }),
      }))
    } else if (editing.type === 'checkpoint') {
      saveGoals(goals.map(g => g.id !== editing.goalId ? g : {
        ...g,
        milestones: g.milestones.map(m => m.id !== editing.milestoneId ? m : {
          ...m,
          checkpoints: (m.checkpoints || []).map(c =>
            c.id !== editing.checkpointId ? c : { ...c, text: editing.text.trim() }
          ),
        }),
      }))
    }
    setEditing(null)
  }

  const filtered = sortGoals(goals.filter(g => {
    if (filter === 'done') return g.milestones.length > 0 && g.milestones.every(m => m.done)
    if (filter === 'active') return g.milestones.length === 0 || g.milestones.some(m => !m.done)
    return true
  }))

  return (
    <>
      <div className="goals-section-label">Goals &amp; Projects</div>
      <div className="gp-micro-copy">Break big things into steps. Push one step to today.</div>

      <div className="gp-toolbar">
        <div className="gp-filter-pills">
          {['all', 'active', 'done'].map(f => (
            <button
              key={f}
              className={`gp-filter-pill${filter === f ? ' gp-filter-pill--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {!showAddGoal && (
          <button className="btn-ghost gp-add-btn" onClick={() => setShowAddGoal(true)}>
            + Add goal
          </button>
        )}
      </div>

      {showAddGoal && (
        <div className="gp-add-goal-form">
          <input
            className="habits-form-input"
            placeholder="Goal title"
            value={formTitle}
            onChange={e => setFormTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addGoal() }}
            autoFocus
          />
          <div className="habits-domain-picker">
            {DOMAINS.map(d => (
              <button
                key={d.id}
                className={`habits-domain-btn${formDomain === d.id ? ' habits-domain-btn--active' : ''}`}
                onClick={() => setFormDomain(d.id)}
              >
                <span className="habit-dot" style={{ background: d.color }} />
                <span>{d.label}</span>
              </button>
            ))}
          </div>
          <div className="gp-horizon-picker">
            {HORIZONS.map(h => (
              <button
                key={h.id}
                className={`gp-horizon-btn${formHorizon === h.id ? ' gp-horizon-btn--active' : ''}`}
                onClick={() => setFormHorizon(h.id)}
              >
                {h.label}
              </button>
            ))}
          </div>
          <textarea
            className="habits-form-input gp-notes-textarea"
            placeholder="Notes (optional)"
            value={formNotes}
            onChange={e => setFormNotes(e.target.value)}
            rows={2}
          />
          <div className="habits-form-actions">
            <button
              className="btn-ghost"
              onClick={() => { setShowAddGoal(false); setFormTitle(''); setFormNotes('') }}
            >
              Cancel
            </button>
            <button className="btn-primary" onClick={addGoal} disabled={!formTitle.trim()}>
              Save goal
            </button>
          </div>
        </div>
      )}

      <div className="gp-list">
        {filtered.length === 0 && (
          <div className="gp-empty">
            {filter === 'done'
              ? 'No completed goals yet.'
              : filter === 'active'
              ? 'No active goals. Add one above.'
              : 'No goals yet.'}
          </div>
        )}

        {filtered.map(goal => {
          const total = goal.milestones.length
          const doneCount = goal.milestones.filter(m => m.done).length
          const progress = total > 0 ? doneCount / total : 0
          const isExpanded = expanded.has(goal.id)
          const isDeleting = deleteConfirm === goal.id

          return (
            <div key={goal.id} className={`gp-card${isExpanded ? ' gp-card--expanded' : ''}`}>
              {isDeleting ? (
                <div className="gp-delete-confirm">
                  <span>Delete "{goal.title}"?</span>
                  <button className="btn-ghost" onClick={() => deleteGoal(goal.id)}>Yes</button>
                  <button className="btn-ghost" onClick={() => setDeleteConfirm(null)}>No</button>
                </div>
              ) : (
                <>
                  <div className="gp-card-header" onClick={() => !editing && toggleExpanded(goal.id)}>
                    <div className="gp-card-header-left">
                      <span className="habit-dot" style={{ background: domainColor(goal.domain) }} />
                      {editing?.type === 'goal' && editing.goalId === goal.id ? (
                        <input
                          className="gp-inline-edit-input"
                          value={editing.text}
                          onChange={e => setEditing({ ...editing, text: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null) }}
                          onBlur={saveEdit}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <span className="gp-card-title">{goal.title}</span>
                      )}
                      <span className={`gp-horizon-badge gp-horizon-badge--${goal.horizon}`}>
                        {HORIZONS.find(h => h.id === goal.horizon)?.label}
                      </span>
                    </div>
                    <div className="gp-card-actions">
                      <button
                        className="gp-edit-btn"
                        onClick={e => { e.stopPropagation(); setEditing({ type: 'goal', goalId: goal.id, text: goal.title }) }}
                        aria-label="Edit goal"
                        title="Rename goal"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        className="gp-trash-btn"
                        onClick={e => { e.stopPropagation(); setDeleteConfirm(goal.id) }}
                        aria-label="Delete goal"
                        title="Delete goal"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

                  <div className="gp-progress-bar-wrap">
                    <div className="gp-progress-bar-fill" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <div className="gp-milestone-count">{doneCount} of {total} milestones done</div>

                  {isExpanded && (
                    <div className="gp-milestones">
                      {goal.milestones.map(m => {
                        const checkpoints = m.checkpoints || []
                        const cpDone = checkpoints.filter(c => c.done).length
                        const isMilestoneExpanded = expandedMilestones.has(m.id)
                        const isAddingCheckpoint = addCheckpointFor?.milestoneId === m.id

                        return (
                          <div key={m.id} className="gp-milestone-item">
                            <div className={`gp-milestone-row${m.done ? ' gp-milestone-row--done' : ''}`}>
                              <button
                                className={`gp-milestone-checkbox${m.done ? ' gp-milestone-checkbox--checked' : ''}`}
                                onClick={() => toggleMilestone(goal.id, m.id)}
                                aria-label={m.done ? 'Mark undone' : 'Mark done'}
                              />
                              <div
                                className="gp-milestone-body gp-milestone-body--clickable"
                                onClick={() => toggleMilestoneExpanded(m.id)}
                              >
                                <div className="gp-milestone-text-row">
                                  <span className={`gp-milestone-text${m.done ? ' gp-milestone-text--done' : ''}`}>
                                    {m.text}
                                  </span>
                                  {checkpoints.length > 0 && (
                                    <span className="gp-cp-badge">{cpDone}/{checkpoints.length}</span>
                                  )}
                                  <span className={`gp-milestone-chevron${isMilestoneExpanded ? ' open' : ''}`}>›</span>
                                </div>
                                {m.due_date && (
                                  <span className="gp-milestone-due">{m.due_date}</span>
                                )}
                              </div>
                              {!m.done && (
                                <button
                                  className={`gp-push-btn${m.pushed_to_date ? ' gp-push-btn--added' : ''}`}
                                  onClick={() => { if (!m.pushed_to_date) pushToToday(goal.id, m.id) }}
                                  disabled={!!m.pushed_to_date}
                                >
                                  {m.pushed_to_date ? '→ Added' : '→ Today'}
                                </button>
                              )}
                              <button
                                className="gp-milestone-delete-btn"
                                onClick={() => deleteMilestone(goal.id, m.id)}
                                title="Delete milestone"
                              >×</button>
                            </div>

                            {isMilestoneExpanded && (
                              <div className="gp-checkpoints">
                                {checkpoints.map(c => (
                                  <div key={c.id} className="gp-checkpoint-row">
                                    <button
                                      className={`gp-checkpoint-cb${c.done ? ' gp-checkpoint-cb--checked' : ''}`}
                                      onClick={() => toggleCheckpoint(goal.id, m.id, c.id)}
                                      aria-label={c.done ? 'Mark undone' : 'Mark done'}
                                    />
                                    <span className={`gp-checkpoint-text${c.done ? ' gp-checkpoint-text--done' : ''}`}>
                                      {c.text}
                                    </span>
                                    <button
                                      className="gp-checkpoint-delete-btn"
                                      onClick={() => deleteCheckpoint(goal.id, m.id, c.id)}
                                      title="Delete checkpoint"
                                    >×</button>
                                  </div>
                                ))}

                                {isAddingCheckpoint ? (
                                  <div className="gp-add-checkpoint-row">
                                    <input
                                      className="gp-add-checkpoint-input"
                                      placeholder="Add a checkpoint…"
                                      value={checkpointText}
                                      onChange={e => setCheckpointText(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') addCheckpoint(goal.id, m.id)
                                        if (e.key === 'Escape') { setAddCheckpointFor(null); setCheckpointText('') }
                                      }}
                                      autoFocus
                                    />
                                    <button
                                      className="gp-add-checkpoint-confirm-btn"
                                      onClick={() => addCheckpoint(goal.id, m.id)}
                                      disabled={!checkpointText.trim()}
                                    >Add</button>
                                    <button
                                      className="gp-add-checkpoint-confirm-btn"
                                      onClick={() => { setAddCheckpointFor(null); setCheckpointText('') }}
                                    >×</button>
                                  </div>
                                ) : (
                                  <button
                                    className="btn-ghost gp-add-cp-inline-btn"
                                    onClick={() => setAddCheckpointFor({ goalId: goal.id, milestoneId: m.id })}
                                  >
                                    + Checkpoint
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {addMilestoneFor === goal.id ? (
                        <div className="gp-add-milestone-form">
                          <input
                            className="habits-form-input"
                            placeholder="Milestone"
                            value={milestoneText}
                            onChange={e => setMilestoneText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addMilestone(goal.id) }}
                            autoFocus
                          />
                          <input
                            type="date"
                            className="gp-date-input"
                            value={milestoneDue}
                            onChange={e => setMilestoneDue(e.target.value)}
                          />
                          <div className="habits-form-actions">
                            <button
                              className="btn-ghost"
                              onClick={() => {
                                setAddMilestoneFor(null)
                                setMilestoneText('')
                                setMilestoneDue('')
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn-primary"
                              onClick={() => addMilestone(goal.id)}
                              disabled={!milestoneText.trim()}
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="btn-ghost gp-add-milestone-btn"
                          onClick={() => setAddMilestoneFor(goal.id)}
                        >
                          + Add milestone
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
