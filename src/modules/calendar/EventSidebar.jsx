import { useState, useEffect } from 'react'
import {
  CATEGORIES, DEFAULT_CATEGORY_HEX,
  toDateStr, minsToTimeStr, roundUpToTen,
} from './calendarUtils.js'

export default function EventSidebar({ event, defaultSlot, currentDate, events, onSave, onDelete, onClose }) {
  const isNew = !event

  const buildInitialForm = () => {
    if (event) {
      const s = new Date(event.start_time)
      const e = new Date(event.end_time)
      return {
        title: event.title || '',
        notes: event.description || '',
        date: toDateStr(s),
        startTime: `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`,
        endTime:   `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`,
        color: event.color || DEFAULT_CATEGORY_HEX,
      }
    }

    if (defaultSlot?.startMin != null) {
      return {
        title: '',
        notes: '',
        date: toDateStr(defaultSlot.date),
        startTime: minsToTimeStr(defaultSlot.startMin),
        endTime:   minsToTimeStr(defaultSlot.endMin),
        color: DEFAULT_CATEGORY_HEX,
      }
    }

    // "+ New" button — compute default from existing events on currentDate
    const dateStr = toDateStr(currentDate)
    const dayEvs = (events || [])
      .filter(ev => !ev.is_all_day && toDateStr(new Date(ev.start_time)) === dateStr)
      .sort((a, b) => new Date(b.end_time) - new Date(a.end_time))

    let startMin
    if (dayEvs.length > 0) {
      const lastEnd = new Date(dayEvs[0].end_time)
      startMin = roundUpToTen(lastEnd.getHours() * 60 + lastEnd.getMinutes())
    } else {
      const now = new Date()
      startMin = roundUpToTen(now.getHours() * 60 + now.getMinutes())
    }
    startMin = Math.min(startMin, 23 * 60 + 50)

    return {
      title: '',
      notes: '',
      date: dateStr,
      startTime: minsToTimeStr(startMin),
      endTime:   minsToTimeStr(startMin + 30),
      color: DEFAULT_CATEGORY_HEX,
    }
  }

  const [form, setForm] = useState(buildInitialForm)
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setOpen(true))
  }, [])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleClose = () => {
    setOpen(false)
    setTimeout(onClose, 260)
  }

  const handleSave = () => {
    if (submitted || !form.title.trim()) return
    const startDt = new Date(`${form.date}T${form.startTime}`)
    const endDt   = new Date(`${form.date}T${form.endTime}`)
    if (endDt <= startDt) return
    setSubmitted(true)
    onSave({
      title: form.title.trim(),
      description: form.notes.trim(),
      start_time: startDt.toISOString(),
      end_time:   endDt.toISOString(),
      color: form.color,
      is_all_day: false,
    })
  }

  const handleDelete = () => {
    onDelete(event.id)
    handleClose()
  }

  return (
    <>
      <div className={`cal-sidebar-backdrop${open ? ' open' : ''}`} onClick={handleClose} />
      <div className={`cal-event-sidebar${open ? ' open' : ''}`}>
        <div className="cal-sidebar-header">
          <span className="cal-sidebar-title">{isNew ? 'New Event' : 'Edit Event'}</span>
          <button className="cal-modal-close" onClick={handleClose}>✕</button>
        </div>

        <div className="cal-sidebar-body">
          <div className="cal-field">
            <label>Title</label>
            <input
              className="cal-input"
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="Event title"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>

          <div className="cal-field">
            <label>Date</label>
            <input
              className="cal-input"
              type="date"
              value={form.date}
              onChange={e => set('date', e.target.value)}
            />
          </div>

          <div className="cal-time-row">
            <div className="cal-field">
              <label>Start</label>
              <input
                className="cal-input"
                type="time"
                value={form.startTime}
                onChange={e => set('startTime', e.target.value)}
              />
            </div>
            <div className="cal-field">
              <label>End</label>
              <input
                className="cal-input"
                type="time"
                value={form.endTime}
                onChange={e => set('endTime', e.target.value)}
              />
            </div>
          </div>

          <div className="cal-field">
            <label>Category</label>
            <div className="cal-category-picker">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.hex}
                  className={`cal-category-btn${form.color === cat.hex ? ' active' : ''}`}
                  style={{ '--cat-color': cat.hex }}
                  onClick={() => set('color', cat.hex)}
                >
                  <span className="cal-category-swatch" style={{ background: cat.hex }} />
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="cal-field">
            <label>Notes</label>
            <textarea
              className="cal-input cal-textarea"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Optional notes…"
              rows={3}
            />
          </div>

          <button
            className="cal-mobile-create-btn"
            onClick={handleSave}
            disabled={submitted || !form.title.trim()}
          >
            {isNew ? 'Create' : 'Save'}
          </button>
        </div>

        <div className="cal-sidebar-footer">
          {!isNew && (
            <button
              className="btn-ghost"
              onClick={handleDelete}
              style={{ marginRight: 'auto', color: 'var(--danger)', borderColor: 'rgba(255,107,107,0.3)' }}
            >
              Delete
            </button>
          )}
          <button className="btn-secondary" onClick={handleClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={submitted || !form.title.trim()}
          >
            {isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}
