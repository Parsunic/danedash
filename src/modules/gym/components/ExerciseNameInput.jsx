import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { searchExercises } from '../../../lib/muscleUtils.js'

export default function ExerciseNameInput({ value, onChange, placeholder = 'Exercise name', style }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [dropRect, setDropRect] = useState(null)
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  const calcRect = useCallback(() => {
    if (!inputRef.current) return
    const r = inputRef.current.getBoundingClientRect()
    setDropRect({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [])

  useEffect(() => {
    if (value.trim().length < 2) { setSuggestions([]); setOpen(false); return }
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
    const close = e => { if (!inputRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = useCallback(name => {
    onChange(name)
    setOpen(false)
    setSuggestions([])
  }, [onChange])

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
          {suggestions.slice(0, 3).map(s => (
            <button key={s.name} className="ex-autocomplete-row" type="button" onClick={() => pick(s.name)}>
              <span className="ex-autocomplete-name">{s.name}</span>
              {s.primary_muscle && (
                <span className={`gym-muscle-badge muscle-${s.primary_muscle}`}>{s.primary_muscle}</span>
              )}
            </button>
          ))}
          <button className="ex-autocomplete-row ex-autocomplete-custom" type="button" onClick={() => pick(value.trim())}>
            + Custom:<strong>{value.trim()}</strong>
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
