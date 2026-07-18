import { useState, useEffect, useRef, useCallback } from 'react'
import { storeGet } from '../../../lib/storage.js'
import { getActiveDateString } from '../../../lib/dateHelpers.js'

// Fixed full-width goals ticker strip rendered ABOVE the card grid.
// Copied verbatim from Dashboard.jsx GoalTicker — not a registry widget.
export default function GoalTickerStrip() {
  const [meta, setMeta] = useState({ done: 0, total: 0 })
  const [rows, setRows] = useState([])
  const cycleIdxRef = useRef(0)
  const rowIdRef = useRef(0)

  const getItems = useCallback(() => {
    const dateStr = getActiveDateString()
    const goals = storeGet('goals:' + dateStr) || []
    const focusEntry = storeGet('daily_focus:' + dateStr)
    const total = goals.length
    const done = goals.filter(g => g.done).length
    const pending = goals.filter(g => !g.done)

    let goalItems
    if (total === 0) goalItems = []
    else if (done === total) goalItems = [{ status: 'done', text: '✓ All goals done — solid day.' }]
    else goalItems = pending.map(g => ({ status: 'pending', text: g.text }))

    if (!focusEntry?.text) {
      if (goalItems.length === 0) return { items: [{ status: 'empty', text: 'No goals set for today — add one to get rolling.' }], done, total }
      return { items: goalItems, done, total }
    }

    const focusItem = { status: 'focus', text: focusEntry.text }
    if (goalItems.length === 0) return { items: [focusItem], done, total }
    const focusCount = Math.max(1, Math.round(goalItems.length * 1.5))
    return { items: [...Array(focusCount).fill(focusItem), ...goalItems], done, total }
  }, [])

  const tick = useCallback((first = false) => {
    const { items, done, total } = getItems()
    setMeta({ done, total })
    cycleIdxRef.current = cycleIdxRef.current % items.length
    const item = items[cycleIdxRef.current]
    cycleIdxRef.current = (cycleIdxRef.current + 1) % items.length
    const id = ++rowIdRef.current
    if (first) {
      setRows([{ id, item, cls: '' }])
      return
    }
    setRows(prev => [
      ...prev.map(r => ({ ...r, cls: 'is-leaving' })),
      { id, item, cls: 'is-entering' },
    ])
    setTimeout(() => setRows(prev => prev.filter(r => r.cls !== 'is-leaving')), 460)
  }, [getItems])

  useEffect(() => {
    tick(true)
    const interval = setInterval(() => tick(false), 5000)
    const onChanged = () => { cycleIdxRef.current = 0; tick(false) }
    window.addEventListener('goals-changed', onChanged)
    return () => {
      clearInterval(interval)
      window.removeEventListener('goals-changed', onChanged)
    }
  }, [tick])

  return (
    <div className="ticker-row">
      <div className="goal-ticker" aria-live="polite" aria-atomic="true">
        <div className="goal-ticker-led"><span className="goal-ticker-led-dot" /></div>
        <div className="goal-ticker-label">GOALS</div>
        <div className="goal-ticker-stage">
          {rows.map(({ id, item, cls }) => (
            <div key={id} className={`goal-ticker-row${cls ? ' ' + cls : ''}`}>
              <span className="goal-ticker-status" data-status={item.status}>
                {item.status === 'done' ? '✓' : item.status === 'pending' ? '○' : '·'}
              </span>
              <span className="goal-ticker-text">{item.text}</span>
            </div>
          ))}
        </div>
        <div className="goal-ticker-meta">{meta.done}/{meta.total}</div>
      </div>
    </div>
  )
}
