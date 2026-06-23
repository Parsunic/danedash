import { useState, useCallback, useRef } from 'react'

// ── Universal "this flips" affordance (swap arrows) ──
export function FlipArrowsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="flip-arrows-icon" aria-hidden="true">
      <path d="M16 3l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 7H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 21l-4-4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// ── Shared content-swap flip driver (matches the Goals ⇄ Tasks switch) ──
// Returns { flipped, animState, isFlipping, flip }. Wrap the swapping content in
// <div className={`flip-content ${animState}`}> and read `flipped` to pick the face.
export function useFlip(initial = false) {
  const [flipped, setFlipped] = useState(initial)
  const [animState, setAnimState] = useState('')
  const busyRef = useRef(false)

  const flip = useCallback((target) => {
    if (busyRef.current) return
    busyRef.current = true
    setAnimState('flip-exit')
    setTimeout(() => {
      setFlipped(cur => (typeof target === 'boolean' ? target : !cur))
      setAnimState('flip-enter')
      setTimeout(() => {
        setAnimState('')
        busyRef.current = false
      }, 320)
    }, 320)
  }, [])

  return { flipped, animState, isFlipping: animState !== '', flip }
}

// ── Understated, tappable title that flips the view ──
// Looks like a section label, not a button — but tapping it flips everything around.
export function FlipTitle({ icon, label, isFlipping, onClick, title, className = '' }) {
  return (
    <button
      type="button"
      className={`flip-title-btn${isFlipping ? ' is-flipping' : ''}${className ? ' ' + className : ''}`}
      onClick={onClick}
      title={title}
    >
      {icon && <span className="flip-title-icon">{icon}</span>}
      <span className="flip-title-label">{label}</span>
      <FlipArrowsIcon />
    </button>
  )
}
