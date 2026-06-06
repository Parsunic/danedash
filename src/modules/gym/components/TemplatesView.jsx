import { useState, useEffect, useCallback, useRef } from 'react'
import { storeGet, storeSet } from '../../../lib/storage.js'
import { gymUUID } from '../gymUtils.js'
import { lookupMusclesBatch } from '../../../lib/muscleUtils.js'

function ExerciseEditorRow({ ex, idx, onChange, onDelete }) {
  return (
    <div className="gym-ex-edit-row">
      <input
        className="gym-input gym-ex-name"
        placeholder="Exercise name"
        value={ex.name}
        onChange={e => onChange(idx, 'name', e.target.value)}
      />
      <input
        className="gym-input gym-ex-sets"
        placeholder="Sets"
        type="number"
        min="1" max="30"
        value={ex.sets}
        onChange={e => onChange(idx, 'sets', parseInt(e.target.value) || 1)}
      />
      <input
        className="gym-input gym-ex-reps"
        placeholder="8–10"
        value={ex.repRange}
        onChange={e => onChange(idx, 'repRange', e.target.value)}
      />
      <input
        className="gym-input gym-ex-notes"
        placeholder="Notes / intensity"
        value={ex.notes}
        onChange={e => onChange(idx, 'notes', e.target.value)}
      />
      <button className="gym-ex-delete" onClick={() => onDelete(idx)} title="Remove">✕</button>
    </div>
  )
}

function TemplateModal({ tpl, onClose, onSave }) {
  const [name, setName] = useState(tpl ? tpl.name : '')
  const [exRows, setExRows] = useState(() => tpl ? tpl.exercises.map(e => ({ ...e })) : [])
  const nameRef = useRef(null)

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 80)
  }, [])

  const changeEx = useCallback((i, field, val) => {
    setExRows(prev => prev.map((r, ri) => ri === i ? { ...r, [field]: val } : r))
  }, [])

  const deleteEx = useCallback(i => {
    setExRows(prev => prev.filter((_, ri) => ri !== i))
  }, [])

  const addEx = useCallback(() => {
    setExRows(prev => [...prev, { name: '', sets: 3, repRange: '8–10', notes: '' }])
    setTimeout(() => {
      const inputs = document.querySelectorAll('.gym-exercise-editor-list .gym-ex-name')
      inputs[inputs.length - 1]?.focus()
    }, 40)
  }, [])

  const save = useCallback(() => {
    if (!name.trim()) { nameRef.current?.focus(); return }
    onSave(name.trim(), exRows.filter(e => e.name.trim()))
  }, [name, exRows, onSave])

  return (
    <div className="gym-modal-overlay open" onClick={e => { if (e.target.classList.contains('gym-modal-overlay')) onClose() }}>
      <div className="gym-modal">
        <div className="gym-modal-title">
          <span>{tpl ? 'Edit Template' : 'New Template'}</span>
          <button className="gym-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="gym-field">
          <label>Template Name</label>
          <input
            ref={nameRef}
            className="gym-input"
            placeholder="e.g. Push Day A"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
          />
        </div>
        <div className="gym-field">
          <label>Exercises</label>
          <div className="gym-exercise-editor-list">
            {exRows.map((ex, i) => (
              <ExerciseEditorRow key={i} ex={ex} idx={i} onChange={changeEx} onDelete={deleteEx} />
            ))}
          </div>
          <button className="btn-ghost" style={{ width: '100%' }} onClick={addEx}>+ Add Exercise</button>
        </div>
        <div className="gym-modal-footer">
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: 2 }} onClick={save}>Save Template</button>
        </div>
      </div>
    </div>
  )
}

function TemplateCard({ tpl, onEdit, onDelete }) {
  const [collapsed, setCollapsed] = useState(true)
  return (
    <div className="template-card">
      <div className="template-card-header" onClick={() => setCollapsed(v => !v)}>
        <div className="template-card-name-row">
          <span className={`template-card-chevron${collapsed ? '' : ' open'}`}>›</span>
          <span className="template-card-name">{tpl.name}</span>
          {collapsed && (
            <span className="template-card-count">{tpl.exercises.length} ex</span>
          )}
        </div>
        <div className="template-card-actions" onClick={e => e.stopPropagation()}>
          <button className="btn-secondary" onClick={() => onEdit(tpl)}>Edit</button>
          <button className="btn-gym-danger" onClick={() => onDelete(tpl)}>Delete</button>
        </div>
      </div>
      {!collapsed && (
        <ul className="template-exercise-list">
          {tpl.exercises.length === 0 ? (
            <li style={{ color: 'var(--text-tertiary)', fontSize: '12px', padding: '4px 0' }}>No exercises — edit to add some.</li>
          ) : tpl.exercises.map((ex, i) => (
            <li key={i} className="template-exercise-row">
              <span className="template-exercise-name">{ex.name}</span>
              <span className="template-exercise-meta">{ex.sets}×{ex.repRange || '—'}</span>
              {ex.notes && <span className="template-exercise-notes">{ex.notes}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function TemplatesView() {
  const [templates, setTemplates] = useState(() => storeGet('gym_templates') || [])
  const [modalTpl, setModalTpl] = useState(undefined) // undefined = closed, null = new, obj = edit

  const reload = useCallback(() => setTemplates(storeGet('gym_templates') || []), [])

  useEffect(() => {
    window.addEventListener('gym-changed', reload)
    return () => window.removeEventListener('gym-changed', reload)
  }, [reload])

  const handleSave = useCallback(async (name, exercises) => {
    const names = exercises.map(e => e.name).filter(Boolean)
    const muscleMap = await lookupMusclesBatch(names).catch(() => ({}))
    const enriched = exercises.map(ex => ({
      ...ex,
      primary_muscle: muscleMap[ex.name] ?? 'other',
    }))

    const tpls = storeGet('gym_templates') || []
    if (modalTpl?.id) {
      const idx = tpls.findIndex(t => t.id === modalTpl.id)
      if (idx >= 0) tpls[idx] = { ...tpls[idx], name, exercises: enriched }
    } else {
      tpls.push({ id: gymUUID(), name, exercises: enriched })
    }
    storeSet('gym_templates', tpls)
    setModalTpl(undefined)
    setTemplates(storeGet('gym_templates') || [])
  }, [modalTpl])

  const handleDelete = useCallback(tpl => {
    if (!confirm(`Delete "${tpl.name}"?`)) return
    const tpls = (storeGet('gym_templates') || []).filter(t => t.id !== tpl.id)
    storeSet('gym_templates', tpls)
    setTemplates(tpls)
  }, [])

  return (
    <div>
      <div className="gym-section-header">
        <div className="section-title" style={{ marginBottom: 0 }}>Workout Templates</div>
        <button className="btn-primary" onClick={() => setModalTpl(null)}>+ New</button>
      </div>
      {templates.length === 0 && (
        <div className="empty-state">No templates yet — create one to get started.</div>
      )}
      {templates.map(tpl => (
        <TemplateCard key={tpl.id} tpl={tpl} onEdit={t => setModalTpl(t)} onDelete={handleDelete} />
      ))}
      {modalTpl !== undefined && (
        <TemplateModal tpl={modalTpl} onClose={() => setModalTpl(undefined)} onSave={handleSave} />
      )}
    </div>
  )
}
