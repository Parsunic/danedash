import { useState, useEffect, useCallback } from 'react'
import { searchExercises, browseExercisesByMuscle, addCustomExercise, deleteCustomExercise } from '../../../lib/muscleUtils.js'

const MUSCLES = ['all', 'chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'other']

export default function ExercisesView() {
  const [query, setQuery] = useState('')
  const [muscleFilter, setMuscleFilter] = useState('all')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [customName, setCustomName] = useState('')
  const [customMuscle, setCustomMuscle] = useState('chest')
  const [addMsg, setAddMsg] = useState('')

  const loadBrowse = useCallback((muscle) => {
    setLoading(true)
    browseExercisesByMuscle(muscle).then(data => {
      setResults(data)
      setLoading(false)
    })
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

  const handleAdd = () => {
    if (!customName.trim()) return
    const added = addCustomExercise(customName.trim(), customMuscle)
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
          {MUSCLES.map(m => (
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
        {!loading && results.map((ex, i) => (
          <div key={i} className="gym-exercise-row">
            <span className="gym-exercise-row-name">{ex.name}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {ex.is_custom && <span className="gym-exercise-custom-tag">custom</span>}
              {ex.primary_muscle && (
                <span className={`gym-muscle-badge muscle-${ex.primary_muscle}`}>{ex.primary_muscle}</span>
              )}
              {ex.is_custom && (
                <button className="gym-set-remove-btn" style={{ padding: '2px 7px', fontSize: 12 }}
                  onClick={() => handleDelete(ex.name)} title="Remove custom exercise">×</button>
              )}
            </div>
          </div>
        ))}
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
              <option key={m} value={m} style={{ textTransform: 'capitalize' }}>{m}</option>
            ))}
          </select>
          <button className="btn-primary" style={{ fontSize: '13px', padding: '8px 14px', flexShrink: 0 }} onClick={handleAdd}>
            + Add
          </button>
        </div>
        {addMsg && <div className="gym-add-ex-msg">{addMsg}</div>}
      </div>
    </div>
  )
}
