import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { searchExercises, addCustomExercise } from '../../../lib/muscleUtils.js'

const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'other']

export default function ExerciseNameInput({ value, onChange, placeholder = 'Exercise name', style }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [dropRect, setDropRect] = useState(null)
  const [customPicker, setCustomPicker] = useState(null) // { name, muscle, added }
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  const calcRect = useCallback(() => {
    if (!inputRef.current) return
    const r = inputRef.current.getBoundingClientRect()
    setDropRect({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [])

  useEffect(() => {
    if (value.trim().length < 2) { setSuggestions([]); setOpen(false); setCustomPicker(null); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const results = await searchExercises(value.trim(), 3)
      setSuggestions(results)
      calcRect()
      setOpen(true)
    }, 200)
    return () => clearTimeout(timerRef.current)
  }, [value, calcRect])

  useEffect(() => {
    const close = e => {
      if (!inputRef.current?.contains(e.target) && !document.querySelector('.ex-autocomplete-dropdown')?.contains(e.target)) {
        setOpen(false)
        setCustomPicker(null)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = useCallback(name => {
    onChange(name)
    setOpen(false)
    setSuggestions([])
    setCustomPicker(null)
  }, [onChange])

  const openCustomPicker = useCallback(name => {
    calcRect()
    setCustomPicker({ name, muscle: 'other', added: false })
  }, [calcRect])

  const handleCustomMuscleSelect = useCallback(muscle => {
    if (!customPicker) return
    setCustomPicker(prev => ({ ...prev, muscle }))
  }, [customPicker])

  const handleCustomAdd = useCallback(() => {
    if (!customPicker) return
    addCustomExercise(customPicker.name, customPicker.muscle)
    window.dispatchEvent(new Event('schedule-sync'))
    setCustomPicker(prev => ({ ...prev, added: true }))
    setTimeout(() => {
      pick(customPicker.name)
    }, 600)
  }, [customPicker, pick])

  const showDrop = open && dropRect && (suggestions.length > 0 || value.trim().length >= 2)

  return (
    <div style={{ position: 'relative', flex: 2, minWidth: 0, ...style }}>
      <input
        ref={inputRef}
        className="gym-input"
        placeholder={placeholder}
        value={value}
        onChange={e => { onChange(e.target.value); calcRect() }}
        onFocus={() => { if (value.trim().length >= 2) { calcRect(); setOpen(true) } }}
        autoComplete="off"
        style={{ width: '100%', marginBottom: 0 }}
      />
      {showDrop && createPortal(
        <div
          className="ex-autocomplete-dropdown"
          style={{ position: 'fixed', top: dropRect.top, left: dropRect.left, width: dropRect.width, zIndex: 9999 }}
          onMouseDown={e => e.preventDefault()}
        >
          {customPicker ? (
            <div className="ex-custom-picker">
              <div className="ex-custom-picker-label">Pick muscle group for "{customPicker.name}"</div>
              <div className="ex-custom-picker-muscles">
                {MUSCLES.map(m => (
                  <button
                    key={m}
                    type="button"
                    className={customPicker.muscle === m ? 'ex-custom-muscle-btn active' : 'ex-custom-muscle-btn'}
                    onClick={() => handleCustomMuscleSelect(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ex-custom-picker-add"
                onClick={handleCustomAdd}
              >
                {customPicker.added ? '✓ Added' : '+ Add to database'}
              </button>
            </div>
          ) : (
            <>
              {suggestions.slice(0, 3).map(s => (
                <button key={s.name} className="ex-autocomplete-row" type="button" onClick={() => pick(s.name)}>
                  <span className="ex-autocomplete-name">{s.name}</span>
                  {s.primary_muscle && (
                    <span className={`gym-muscle-badge muscle-${s.primary_muscle}`}>{s.primary_muscle}</span>
                  )}
                </button>
              ))}
              <button className="ex-autocomplete-row ex-autocomplete-custom" type="button"
                onClick={() => openCustomPicker(value.trim())}>
                + Custom: <strong>{value.trim()}</strong>
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
