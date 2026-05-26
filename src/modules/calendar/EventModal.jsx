import { useState, useEffect } from 'react'
import { MODULE_TAGS, TAG_STYLES, toDateStr, toTimeStr } from './calendarUtils.js'

const RECURRENCE_OPTIONS = [
  { value: '',        label: 'Does not repeat' },
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

export default function EventModal({ event, defaultSlot, currentDate, onSave, onDelete, onClose }) {
  const isNew = !event

  const defaultDate = defaultSlot?.date || currentDate || new Date()
  const defaultStart = defaultSlot ? toTimeStr(defaultSlot.startHour) : '09:00'
  const defaultEnd   = defaultSlot ? toTimeStr(defaultSlot.endHour)   : '10:00'

  const [form, setForm] = useState(() => {
    if (event) {
      const s = new Date(event.start_time)
      const e = new Date(event.end_time)
      return {
        title: event.title || '',
        description: event.description || '',
        date: toDateStr(s),
        startTime: toTimeStr(s.getHours(), s.getMinutes()),
        endTime:   toTimeStr(e.getHours(), e.getMinutes()),
        module_tag: event.module_tag || 'personal',
        recurrence_rule: event.recurrence_rule || '',
        is_all_day: event.is_all_day || false,
      }
    }
    return {
      title: '',
      description: '',
      date: toDateStr(defaultDate),
      startTime: defaultStart,
      endTime: defaultEnd,
      module_tag: 'personal',
      recurrence_rule: '',
      is_all_day: false,
    }
  })

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleSave = () => {
    if (!form.title.trim()) return
    const startDt = new Date(`${form.date}T${form.startTime}`)
    const endDt   = new Date(`${form.date}T${form.endTime}`)
    if (endDt <= startDt) return

    onSave({
      title: form.title.trim(),
      description: form.description.trim(),
      start_time: startDt.toISOString(),
      end_time: endDt.toISOString(),
      module_tag: form.module_tag,
      recurrence_rule: form.recurrence_rule || null,
      is_all_day: form.is_all_day,
    })
  }

  return (
    <div className="cal-modal-overlay" onClick={onClose}>
      <div className="cal-modal" onClick={e => e.stopPropagation()}>
        <div className="cal-modal-title">
          <span>{isNew ? 'New Event' : 'Edit Event'}</span>
          <button className="cal-modal-close" onClick={onClose}>✕</button>
        </div>

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
          <div className="cal-tag-picker">
            {MODULE_TAGS.filter(t => t !== 'gym').map(tag => (
              <button
                key={tag}
                className={`cal-tag-btn${form.module_tag === tag ? ' active' : ''}`}
                style={form.module_tag === tag ? {
                  background: TAG_STYLES[tag].bg,
                  borderColor: TAG_STYLES[tag].border,
                  color: TAG_STYLES[tag].color,
                } : {}}
                onClick={() => set('module_tag', tag)}
              >
                {TAG_STYLES[tag].icon} {tag.charAt(0).toUpperCase() + tag.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="cal-field">
          <label>Description</label>
          <textarea
            className="cal-input cal-textarea"
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Optional notes…"
            rows={2}
          />
        </div>

        <div className="cal-field">
          <label>Repeat</label>
          <select
            className="cal-input cal-recur-select"
            value={form.recurrence_rule}
            onChange={e => set('recurrence_rule', e.target.value)}
          >
            {RECURRENCE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="cal-modal-footer">
          {!isNew && (
            <button
              className="btn-gym-danger"
              onClick={() => onDelete(event.id)}
              style={{ marginRight: 'auto' }}
            >
              Delete
            </button>
          )}
          <button className="btn-gym-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-gym-primary"
            onClick={handleSave}
            disabled={!form.title.trim()}
          >
            {isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
