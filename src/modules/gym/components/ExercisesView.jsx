import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { searchExercises, browseExercisesByMuscle, addCustomExercise, deleteCustomExercise, getCustomExercises } from '../../../lib/muscleUtils.js'
import { storeGet, storeSet } from '../../../lib/storage.js'
import { supabase } from '../../../lib/supabase.js'
import { SUB_TO_LIB_MUSCLE, DEFAULT_SUB_MUSCLES } from '../../../lib/subMuscleData.js'
import BodySVG from './BodySVG.jsx'

const MUSCLES = ['all', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'other']
const FILTER_BTNS = [...MUSCLES, 'custom']

function renameExerciseEverywhere(oldName, newName) {
  const norm = s => s.toLowerCase().trim()
  const old = norm(oldName)
  let changed = false

  const renameInList = (list, key) => {
    const next = list.map(item => ({
      ...item,
      exercises: (item.exercises || []).map(ex =>
        norm(ex.name) === old ? { ...ex, name: newName } : ex
      ),
    }))
    storeSet(key, next)
    changed = true
  }

  // gym_workout_logs — exercises nested in log entries
  const logs = storeGet('gym_workout_logs') || []
  const newLogs = logs.map(log => ({
    ...log,
    exercises: (log.exercises || []).map(ex =>
      norm(ex.name) === old ? { ...ex, name: newName } : ex
    ),
  }))
  storeSet('gym_workout_logs', newLogs)
  changed = true

  // gym_planned
  renameInList(storeGet('gym_planned') || [], 'gym_planned')

  // gym_templates
  renameInList(storeGet('gym_templates') || [], 'gym_templates')

  // gym_exercise_history — object keyed by exercise name
  const history = storeGet('gym_exercise_history') || {}
  if (history[oldName] !== undefined) {
    const next = { ...history, [newName]: history[oldName] }
    delete next[oldName]
    storeSet('gym_exercise_history', next)
    changed = true
  }

  // custom_exercises
  const customs = getCustomExercises()
  if (customs.some(e => norm(e.name) === old)) {
    storeSet('custom_exercises', customs.map(e => norm(e.name) === old ? { ...e, name: newName } : e))
    changed = true
  }

  if (changed) {
    window.dispatchEvent(new Event('gym-changed'))
    window.dispatchEvent(new Event('schedule-sync'))
  }
}

function formatSubMuscle(name) {
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function buildExBodyData(subMuscles) {
  const { primary = [], secondary = [] } = subMuscles
  const libScore = {}
  for (const m of primary) {
    const lib = SUB_TO_LIB_MUSCLE[m]
    if (lib) libScore[lib] = (libScore[lib] || 0) + 1
  }
  for (const m of secondary) {
    const lib = SUB_TO_LIB_MUSCLE[m]
    if (lib) libScore[lib] = (libScore[lib] || 0) + 0.4
  }
  const max = Math.max(...Object.values(libScore), 0)
  if (max <= 0) return []
  return Object.entries(libScore).map(([lib, score]) => ({
    name: lib, muscles: [lib], frequency: Math.max(1, Math.min(5, Math.ceil((score / max) * 5))),
  }))
}

async function fetchExSubMuscles(ex) {
  if (ex.is_custom) {
    const found = getCustomExercises().find(e => e.name.toLowerCase() === ex.name.toLowerCase())
    if (found?.primary_sub_muscles?.length) {
      return { primary: found.primary_sub_muscles, secondary: found.secondary_sub_muscles || [] }
    }
    if (found?.primary_muscle && DEFAULT_SUB_MUSCLES[found.primary_muscle]) {
      return DEFAULT_SUB_MUSCLES[found.primary_muscle]
    }
  }
  const { data } = await supabase
    .from('exercises')
    .select('primary_sub_muscles, secondary_sub_muscles, primary_muscle')
    .ilike('name', ex.name)
    .limit(1)
  if (data?.[0]) {
    if (data[0].primary_sub_muscles?.length) {
      return { primary: data[0].primary_sub_muscles, secondary: data[0].secondary_sub_muscles || [] }
    }
    const muscle = data[0].primary_muscle
    if (muscle && DEFAULT_SUB_MUSCLES[muscle]) return DEFAULT_SUB_MUSCLES[muscle]
  }
  if (ex.primary_muscle && DEFAULT_SUB_MUSCLES[ex.primary_muscle]) {
    return DEFAULT_SUB_MUSCLES[ex.primary_muscle]
  }
  return { primary: [], secondary: [] }
}

// Popover positioned near the clicked exercise row, rendered via portal
function ExerciseDetailPopover({ detail, onClose }) {
  const popRef = useRef(null)

  useEffect(() => {
    const close = e => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [onClose])

  const vW = window.innerWidth
  const vH = window.innerHeight
  const PANEL_W = Math.min(vW - 32, 500)
  const PANEL_H = 480

  const left = Math.max(16, (vW - PANEL_W) / 2)
  let top = detail.rect.bottom + 8
  if (top + PANEL_H > vH - 16) top = detail.rect.top - PANEL_H - 8
  top = Math.max(16, Math.min(top, vH - PANEL_H - 16))

  const { ex, subMuscles, bodyData } = detail

  return createPortal(
    <div
      ref={popRef}
      style={{
        position: 'fixed',
        top,
        left,
        width: PANEL_W,
        zIndex: 9990,
        background: '#0d0d0f',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: '20px',
        boxShadow: '0 8px 48px rgba(0,0,0,0.75)',
        overflowY: 'auto',
        maxHeight: PANEL_H,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 500, fontSize: 15 }}>{ex.name}</span>
          {ex.primary_muscle && (
            <span className={`gym-muscle-badge muscle-${ex.primary_muscle}`} style={{ fontSize: 10 }}>{ex.primary_muscle}</span>
          )}
        </div>
        <button className="gym-modal-close" onClick={onClose} style={{ flexShrink: 0 }}>✕</button>
      </div>

      {/* Body map — data already loaded, renders immediately */}
      {bodyData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
          No muscle data available for this exercise.
        </div>
      ) : (
        <BodySVG data={bodyData} />
      )}

      {/* Sub-muscle chips */}
      {(subMuscles.primary.length > 0 || subMuscles.secondary.length > 0) && (
        <div style={{ marginTop: 14, display: 'flex', gap: 14 }}>
          {subMuscles.primary.length > 0 && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Primary</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {subMuscles.primary.map(m => (
                  <span key={m} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, background: 'rgba(232,160,32,0.15)', color: 'var(--accent)', border: '1px solid rgba(232,160,32,0.25)' }}>
                    {formatSubMuscle(m)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {subMuscles.secondary.length > 0 && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Secondary</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {subMuscles.secondary.map(m => (
                  <span key={m} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    {formatSubMuscle(m)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  )
}

function EditCustomModal({ ex, onSave, onClose }) {
  const [name, setName] = useState(ex.name)
  const [muscle, setMuscle] = useState(ex.primary_muscle || 'other')

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(ex.name, trimmed, muscle)
  }

  return (
    <div className="gym-modal-overlay open" onClick={e => { if (e.target.classList.contains('gym-modal-overlay')) onClose() }}>
      <div className="gym-modal" style={{ maxWidth: 380 }}>
        <div className="gym-modal-title">
          <span>Edit Custom Exercise</span>
          <button className="gym-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="gym-field">
          <label>Exercise Name</label>
          <input className="gym-input" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()} autoFocus />
        </div>
        <div className="gym-field">
          <label>Muscle Group</label>
          <select className="gym-input" value={muscle} onChange={e => setMuscle(e.target.value)}>
            {MUSCLES.filter(m => m !== 'all').map(m => (
              <option key={m} value={m} style={{ textTransform: 'capitalize' }}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="gym-modal-footer">
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: 2 }} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

export default function ExercisesView() {
  const [query, setQuery] = useState('')
  const [muscleFilter, setMuscleFilter] = useState('all')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [customName, setCustomName] = useState('')
  const [customMuscle, setCustomMuscle] = useState('chest')
  const [addMsg, setAddMsg] = useState('')
  const [editingEx, setEditingEx] = useState(null)
  const [exDetail, setExDetail] = useState(null)   // { ex, subMuscles, bodyData, rect }
  const [fetchingEx, setFetchingEx] = useState(null) // name being fetched

  const loadBrowse = useCallback((muscle) => {
    setLoading(true)
    if (muscle === 'custom') {
      const customs = getCustomExercises()
      setResults(customs)
      setLoading(false)
    } else {
      browseExercisesByMuscle(muscle).then(data => {
        setResults(data)
        setLoading(false)
      })
    }
  }, [])

  useEffect(() => {
    if (query.trim().length < 2) {
      loadBrowse(muscleFilter)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      const data = await searchExercises(query)
      setResults(data)
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, muscleFilter, loadBrowse])

  const handleFilterClick = (m) => {
    setMuscleFilter(m)
    setQuery('')
  }

  const handleExerciseClick = useCallback(async (ex, e) => {
    if (fetchingEx) return
    const rect = e.currentTarget.getBoundingClientRect()
    setFetchingEx(ex.name)
    setExDetail(null)
    try {
      const subMuscles = await fetchExSubMuscles(ex)
      const bodyData = buildExBodyData(subMuscles)
      setExDetail({ ex, subMuscles, bodyData, rect })
    } finally {
      setFetchingEx(null)
    }
  }, [fetchingEx])

  const handleAdd = async () => {
    if (!customName.trim()) return
    const added = await addCustomExercise(customName.trim(), customMuscle)
    if (added) {
      setAddMsg(`✓ "${customName.trim()}" added`)
      setCustomName('')
      loadBrowse(muscleFilter)
      setTimeout(() => setAddMsg(''), 3000)
    } else {
      setAddMsg('Already in the database')
      setTimeout(() => setAddMsg(''), 2500)
    }
  }

  const handleDelete = (name) => {
    deleteCustomExercise(name)
    loadBrowse(muscleFilter)
  }

  const handleEditSave = (oldName, newName, newMuscle) => {
    const customs = getCustomExercises()
    const updated = customs.map(e =>
      e.name === oldName ? { ...e, name: newName, primary_muscle: newMuscle } : e
    )
    storeSet('custom_exercises', updated)
    setEditingEx(null)
    loadBrowse(muscleFilter)
  }

  return (
    <div className="gym-exercises-view">
      <input
        className="gym-ex-search"
        placeholder="Search all exercises..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      {query.trim().length < 2 && (
        <div className="gym-muscle-filter-row">
          {FILTER_BTNS.map(m => (
            <button
              key={m}
              className={muscleFilter === m ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: '0.72rem', padding: '4px 9px', textTransform: 'capitalize' }}
              onClick={() => handleFilterClick(m)}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      <div className="gym-exercises-list">
        {loading && <div className="gym-exercises-placeholder">···</div>}
        {!loading && results.length === 0 && (
          <div className="gym-exercises-placeholder">No exercises found</div>
        )}
        {!loading && results.map((ex, i) => {
          const isFetching = fetchingEx === ex.name
          return (
            <div
              key={i}
              className="gym-exercise-row"
              style={{ cursor: fetchingEx ? (isFetching ? 'wait' : 'default') : 'pointer', opacity: fetchingEx && !isFetching ? 0.5 : 1 }}
              onClick={e => !fetchingEx && handleExerciseClick(ex, e)}
            >
              <span className="gym-exercise-row-name">
                {ex.name}
                {isFetching && <span style={{ marginLeft: 8, color: 'var(--text-tertiary)', fontSize: 12 }}>···</span>}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {ex.is_custom && <span className="gym-exercise-custom-tag">custom</span>}
                {ex.primary_muscle && (
                  <span className={`gym-muscle-badge muscle-${ex.primary_muscle}`}>{ex.primary_muscle}</span>
                )}
                {ex.is_custom && (
                  <>
                    <button className="gym-set-remove-btn" style={{ padding: '2px 7px', fontSize: 12, color: 'var(--accent)' }}
                      onClick={e => { e.stopPropagation(); setEditingEx(ex) }} title="Edit custom exercise">✎</button>
                    <button className="gym-set-remove-btn" style={{ padding: '2px 7px', fontSize: 12 }}
                      onClick={e => { e.stopPropagation(); handleDelete(ex.name) }} title="Remove custom exercise">×</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="gym-add-exercise-form">
        <div className="gym-section-micro" style={{ marginBottom: 8 }}>Add Custom Exercise</div>
        <div className="gym-add-ex-row">
          <input
            className="gym-input"
            placeholder="Exercise name"
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={{ flex: 1, fontSize: '13px', padding: '8px 12px' }}
          />
          <select
            className="gym-input"
            value={customMuscle}
            onChange={e => setCustomMuscle(e.target.value)}
            style={{ fontSize: '13px', padding: '8px 10px', flexShrink: 0, textTransform: 'capitalize' }}
          >
            {MUSCLES.filter(m => m !== 'all').map(m => (
              <option key={m} value={m} style={{ textTransform: 'capitalize' }}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
          <button className="btn-primary" style={{ fontSize: '13px', padding: '8px 14px', flexShrink: 0 }} onClick={handleAdd}>
            + Add
          </button>
        </div>
        {addMsg && <div className="gym-add-ex-msg">{addMsg}</div>}
      </div>

      {editingEx && (
        <EditCustomModal
          ex={editingEx}
          onSave={handleEditSave}
          onClose={() => setEditingEx(null)}
        />
      )}
      {exDetail && (
        <ExerciseDetailPopover detail={exDetail} onClose={() => setExDetail(null)} />
      )}
    </div>
  )
}
