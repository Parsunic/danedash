import { useState, useEffect, useCallback, useRef } from 'react'
import { storeGet, storeSet } from '../../../lib/storage.js'
import { getActiveDateString } from '../../../lib/dateHelpers.js'
import { gymUUID, DSHORT, DFULL, MONTHS, dateToStr } from '../gymUtils.js'

function getWeekStart(offset) {
  const now = new Date()
  const sun = new Date(now)
  sun.setDate(now.getDate() - now.getDay() + offset * 7)
  sun.setHours(0, 0, 0, 0)
  return sun
}

function WeekTemplateModal({ onClose, onSave }) {
  const [name, setName] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80) }, [])
  return (
    <div className="gym-modal-overlay open" onClick={e => { if (e.target.classList.contains('gym-modal-overlay')) onClose() }}>
      <div className="gym-modal" style={{ maxWidth: 420 }}>
        <div className="gym-modal-title">
          <span>Save Week Template</span>
          <button className="gym-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="gym-field">
          <label>Template Name</label>
          <input
            ref={inputRef}
            className="gym-input"
            placeholder="e.g. PPL Split, Upper/Lower"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim())}
          />
        </div>
        <div className="gym-modal-footer">
          <button className="btn-gym-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn-gym-primary" style={{ flex: 2 }} onClick={() => name.trim() && onSave(name.trim())}>Save</button>
        </div>
      </div>
    </div>
  )
}

function DayModal({ ds, existing, templates, onClose, onSave, onRemove, onStartWorkout }) {
  const [y, m, d] = ds.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const title = DFULL[date.getDay()] + ', ' + MONTHS[m - 1] + ' ' + d
  const initSel = existing ? (existing.templateId || (existing.name ? '__custom__' : '')) : ''
  const [sel, setSel] = useState(initSel)
  const [customName, setCustomName] = useState(existing?.name || '')
  const [status, setStatus] = useState(existing ? (existing.status || 'upcoming') : 'upcoming')

  const canStart = existing && existing.status !== 'completed' && existing.exercises?.length > 0

  const save = useCallback(() => {
    if (sel === '') { onRemove(); return }
    let name, templateId, exercises
    if (sel === '__custom__') {
      name = customName.trim() || 'Custom Workout'; templateId = null; exercises = []
    } else {
      const tpl = templates.find(t => t.id === sel)
      name = tpl ? tpl.name : 'Workout'; templateId = sel; exercises = tpl ? tpl.exercises : []
    }
    onSave({ name, templateId, exercises, status: existing ? status : 'upcoming' })
  }, [sel, customName, status, templates, existing, onRemove, onSave])

  return (
    <div className="gym-modal-overlay open" onClick={e => { if (e.target.classList.contains('gym-modal-overlay')) onClose() }}>
      <div className="gym-modal" style={{ maxWidth: 500 }}>
        <div className="gym-modal-title">
          <span>{title}</span>
          <button className="gym-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="gym-field">
          <label>Assign Template</label>
          <select className="template-select" value={sel} onChange={e => setSel(e.target.value)}>
            <option value="">— Rest Day —</option>
            <option value="__custom__">Custom Workout</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {sel === '__custom__' && (
          <div className="gym-field">
            <label>Workout Name</label>
            <input className="gym-input" placeholder="Custom Workout" value={customName} onChange={e => setCustomName(e.target.value)} />
          </div>
        )}
        {existing && (
          <div className="gym-field">
            <label>Status</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-gym-secondary"
                style={{ flex: 1, background: status !== 'completed' ? 'rgba(242,192,99,0.14)' : '' }}
                onClick={() => setStatus('upcoming')}
              >Upcoming</button>
              <button
                className="btn-gym-secondary"
                style={{ flex: 1, background: status === 'completed' ? 'rgba(107,227,164,0.14)' : '' }}
                onClick={() => setStatus('completed')}
              >✓ Completed</button>
            </div>
          </div>
        )}
        {canStart && (
          <button className="btn-gym-primary" style={{ width: '100%', marginTop: 14, marginBottom: 4, padding: 12, fontSize: 14 }} onClick={() => { onStartWorkout(existing); onClose() }}>▶ Start Workout</button>
        )}
        <div className="gym-modal-footer" style={{ flexWrap: 'wrap' }}>
          {existing && <button className="btn-gym-danger" onClick={onRemove}>Remove</button>}
          <button className="btn-gym-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn-gym-primary" style={{ flex: 2 }} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

export default function PlannerView({ onStartWorkout }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [planned, setPlanned] = useState(() => storeGet('gym_planned') || [])
  const [weekTpls, setWeekTpls] = useState(() => storeGet('gym_week_tpls') || [])
  const [templates, setTemplates] = useState(() => storeGet('gym_templates') || [])
  const [dayModal, setDayModal] = useState(null)
  const [weekTplModal, setWeekTplModal] = useState(false)
  const todayStr = getActiveDateString()

  const reload = useCallback(() => {
    setPlanned(storeGet('gym_planned') || [])
    setWeekTpls(storeGet('gym_week_tpls') || [])
    setTemplates(storeGet('gym_templates') || [])
  }, [])

  useEffect(() => {
    window.addEventListener('gym-changed', reload)
    return () => window.removeEventListener('gym-changed', reload)
  }, [reload])

  const ws = getWeekStart(weekOffset)
  const we = new Date(ws); we.setDate(ws.getDate() + 6)
  const weekLabel = `${MONTHS[ws.getMonth()]} ${ws.getDate()} – ${MONTHS[we.getMonth()]} ${we.getDate()}, ${we.getFullYear()}`

  const days = Array.from({ length: 7 }, (_, d) => {
    const date = new Date(ws); date.setDate(ws.getDate() + d)
    const ds = dateToStr(date)
    const isToday = ds === todayStr
    const pw = planned.find(p => p.date === ds)
    const isDone = pw && pw.status === 'completed'
    return { d, date, ds, isToday, pw, isDone }
  })

  const handleDaySave = useCallback(({ name, templateId, exercises, status }) => {
    const { ds } = dayModal
    const existing = planned.find(p => p.date === ds)
    const pw = {
      id: existing ? existing.id : gymUUID(),
      date: ds, name, templateId, exercises, status
    }
    const next = [...(storeGet('gym_planned') || []).filter(p => p.date !== ds), pw]
    storeSet('gym_planned', next)
    setPlanned(next)
    setDayModal(null)
  }, [dayModal, planned])

  const handleDayRemove = useCallback(() => {
    const { ds } = dayModal
    const next = (storeGet('gym_planned') || []).filter(p => p.date !== ds)
    storeSet('gym_planned', next)
    setPlanned(next)
    setDayModal(null)
  }, [dayModal])

  const saveWeekTpl = useCallback(name => {
    const wPlanned = storeGet('gym_planned') || []
    const days = {}
    for (let d = 0; d < 7; d++) {
      const date = new Date(ws); date.setDate(ws.getDate() + d)
      const pw = wPlanned.find(p => p.date === dateToStr(date))
      if (pw) days[d] = { name: pw.name, templateId: pw.templateId, exercises: pw.exercises }
    }
    const wts = [...(storeGet('gym_week_tpls') || []), { id: gymUUID(), name, days }]
    storeSet('gym_week_tpls', wts)
    setWeekTpls(wts)
    setWeekTplModal(false)
  }, [ws])

  const applyWeekTpl = useCallback(wtId => {
    const wt = (storeGet('gym_week_tpls') || []).find(w => w.id === wtId)
    if (!wt) return
    const allTemplates = storeGet('gym_templates') || []
    let p = [...(storeGet('gym_planned') || [])]
    for (let d = 0; d < 7; d++) {
      const date = new Date(ws); date.setDate(ws.getDate() + d)
      const ds = dateToStr(date)
      p = p.filter(x => x.date !== ds)
      const dayData = wt.days[d]
      if (dayData) {
        let { name, templateId, exercises } = dayData
        if (templateId) {
          const tpl = allTemplates.find(t => t.id === templateId)
          if (tpl) { name = tpl.name; exercises = tpl.exercises }
        }
        p.push({ id: gymUUID(), date: ds, name, templateId: templateId || null, exercises: exercises || [], status: 'upcoming' })
      }
    }
    storeSet('gym_planned', p)
    setPlanned(p)
  }, [ws])

  const deleteWeekTpl = useCallback(wtId => {
    if (!confirm(`Delete week template?`)) return
    const wts = (storeGet('gym_week_tpls') || []).filter(w => w.id !== wtId)
    storeSet('gym_week_tpls', wts)
    setWeekTpls(wts)
  }, [])

  return (
    <div>
      <div className="planner-week-nav">
        <button className="planner-nav-btn" onClick={() => setWeekOffset(o => o - 1)}>‹</button>
        <span className="planner-week-label">{weekLabel}</span>
        <button className="planner-nav-btn" onClick={() => setWeekOffset(o => o + 1)}>›</button>
      </div>

      <div className="planner-grid">
        {days.map(({ d, date, ds, isToday, pw, isDone }) => (
          <div key={d} className="planner-day-col">
            <div className={`planner-day-header${isToday ? ' is-today' : ''}`}>{DSHORT[d]}</div>
            <div
              className={`planner-day-cell${isToday ? ' is-today' : ''}${isDone ? ' is-completed' : ''}${pw && !isDone ? ' has-workout' : ''}`}
              onClick={() => setDayModal({ ds, existing: pw || null })}
            >
              <div className={`planner-day-num${isToday ? ' is-today' : ''}`}>{date.getDate()}</div>
              {pw
                ? <div className={`planner-workout-chip${isDone ? ' is-completed' : ''}`}>{pw.name || 'Workout'}</div>
                : <div className="planner-add-plus">+</div>
              }
            </div>
          </div>
        ))}
      </div>

      <div className="section-title">Week Templates</div>
      <div className="gym-section-header" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Save or apply a full weekly split</div>
        <button className="btn-gym-secondary" onClick={() => setWeekTplModal(true)}>Save This Week</button>
      </div>
      {weekTpls.length === 0 && <div className="empty-state">No week templates saved yet.</div>}
      {weekTpls.map(wt => {
        const cnt = Object.values(wt.days).filter(Boolean).length
        return (
          <div key={wt.id} className="week-template-card">
            <div>
              <div className="week-template-name">{wt.name}</div>
              <div className="week-template-meta">{cnt} workout day{cnt !== 1 ? 's' : ''}</div>
            </div>
            <div className="week-template-actions">
              <button className="btn-gym-secondary" onClick={() => applyWeekTpl(wt.id)}>Apply to Week</button>
              <button className="btn-gym-danger" onClick={() => deleteWeekTpl(wt.id)}>Del</button>
            </div>
          </div>
        )
      })}

      {dayModal && (
        <DayModal
          ds={dayModal.ds}
          existing={dayModal.existing}
          templates={templates}
          onClose={() => setDayModal(null)}
          onSave={handleDaySave}
          onRemove={handleDayRemove}
          onStartWorkout={pw => onStartWorkout(pw.exercises, pw.id, pw.name)}
        />
      )}
      {weekTplModal && <WeekTemplateModal onClose={() => setWeekTplModal(false)} onSave={saveWeekTpl} />}
    </div>
  )
}
