import { useState, useEffect, useCallback } from 'react'
import { storeGet, storeSet } from '../../../lib/storage.js'
import { getActiveDateString } from '../../../lib/dateHelpers.js'
import { gymUUID, DSHORT, DFULL, MONTHS, dateToStr } from '../gymUtils.js'
import { lookupMusclesBatch } from '../../../lib/muscleUtils.js'

const MUSCLE_COLORS = {
  chest: '#E03131', shoulders: '#F59F00', back: '#1971C2',
  biceps: '#7048E8', triceps: '#E8590C', abs: '#20C997',
  legs: '#2F9E44', other: '#868E96',
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function buildCellGradient(topMuscles) {
  if (!topMuscles.length) return undefined
  const c1 = MUSCLE_COLORS[topMuscles[0]]
  if (topMuscles.length === 1) {
    return `radial-gradient(ellipse at 50% 90%, ${hexToRgba(c1, 0.55)} 0%, transparent 58%)`
  }
  const c2 = MUSCLE_COLORS[topMuscles[1]]
  return `radial-gradient(ellipse at 20% 90%, ${hexToRgba(c1, 0.55)} 0%, transparent 50%), radial-gradient(ellipse at 80% 90%, ${hexToRgba(c2, 0.55)} 0%, transparent 50%)`
}

const MUSCLE_LABELS = {
  chest: 'Chest', shoulders: 'Shoulders', back: 'Back',
  biceps: 'Biceps', triceps: 'Triceps', abs: 'Abs', legs: 'Legs', other: 'Other',
}
const PRIMARY_MUSCLES = ['chest', 'back', 'legs']
const ALL_MUSCLES = ['chest', 'back', 'legs', 'shoulders', 'biceps', 'triceps', 'abs', 'other']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getTop2Muscles(muscles) {
  if (!muscles.length) return []
  const c = {}
  for (const m of muscles) c[m] = (c[m] || 0) + 1
  return Object.entries(c)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return (PRIMARY_MUSCLES.includes(b[0]) ? 1 : 0) - (PRIMARY_MUSCLES.includes(a[0]) ? 1 : 0)
    })
    .slice(0, 2)
    .map(([n]) => n)
}

function getWeekStart(offset) {
  const now = new Date()
  const sun = new Date(now)
  sun.setDate(now.getDate() - now.getDay() + offset * 7)
  sun.setHours(0, 0, 0, 0)
  return sun
}

function getMonthGrid(monthOffset) {
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const y = base.getFullYear(), m = base.getMonth()
  const firstDow = base.getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) {
    const d = new Date(y, m, 1 - (firstDow - i))
    cells.push({ date: d, ds: dateToStr(d), inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d)
    cells.push({ date, ds: dateToStr(date), inMonth: true })
  }
  const rem = (7 - (cells.length % 7)) % 7
  for (let d = 1; d <= rem; d++) {
    const date = new Date(y, m + 1, d)
    cells.push({ date, ds: dateToStr(date), inMonth: false })
  }
  return { cells, y, m, label: `${MONTH_NAMES[m]} ${y}` }
}

function WeekTemplateModal({ onClose, onSave }) {
  const [name, setName] = useState('')
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
            className="gym-input"
            placeholder="e.g. PPL Split, Upper/Lower"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim())}
            autoFocus
          />
        </div>
        <div className="gym-modal-footer">
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: 2 }} onClick={() => name.trim() && onSave(name.trim())}>Save</button>
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
      name = customName.trim() || 'Freestyle Workout'; templateId = null; exercises = []
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
            <option value="__custom__">Freestyle Workout</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {sel === '__custom__' && (
          <div className="gym-field">
            <label>Workout Name</label>
            <input className="gym-input" placeholder="Freestyle Workout" value={customName} onChange={e => setCustomName(e.target.value)} />
          </div>
        )}
        {existing && (
          <div className="gym-field">
            <label>Status</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={status !== 'completed' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => setStatus('upcoming')}>Upcoming</button>
              <button className={status === 'completed' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => setStatus('completed')}>✓ Completed</button>
            </div>
          </div>
        )}
        {canStart && (
          <button className="btn-primary" style={{ width: '100%', marginTop: 14, marginBottom: 4, padding: 12, fontSize: 14 }} onClick={() => { onStartWorkout(existing); onClose() }}>▶ Start Workout</button>
        )}
        <div className="gym-modal-footer" style={{ flexWrap: 'wrap' }}>
          {existing && <button className="btn-ghost" style={{ color: 'var(--danger)', borderColor: 'rgba(255,107,107,0.3)' }} onClick={onRemove}>Remove</button>}
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: 2 }} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

export default function PlannerView({ weekOffset = 0, onWeekOffsetChange = () => {}, onStartWorkout, desktopMode = false, onViewModeChange }) {
  const [planned, setPlanned] = useState(() => storeGet('gym_planned') || [])
  const [weekTpls, setWeekTpls] = useState(() => storeGet('gym_week_tpls') || [])
  const [templates, setTemplates] = useState(() => storeGet('gym_templates') || [])
  const [dayModal, setDayModal] = useState(null)
  const [weekTplModal, setWeekTplModal] = useState(false)
  const [weekTplsOpen, setWeekTplsOpen] = useState(true)
  const [viewMode, setViewModeRaw] = useState('month')
  const setViewMode = useCallback(mode => { setViewModeRaw(mode); onViewModeChange?.(mode) }, [onViewModeChange])
  const [monthOffset, setMonthOffset] = useState(0)
  const [muscleDayData, setMuscleDayData] = useState({})
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

  // Load muscle group data for the visible month
  useEffect(() => {
    if (viewMode !== 'month') return
    const now = new Date()
    const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const y = base.getFullYear(), mo = base.getMonth()
    const pad = n => String(n).padStart(2, '0')
    const firstStr = `${y}-${pad(mo + 1)}-01`
    const lastStr = `${y}-${pad(mo + 1)}-${pad(new Date(y, mo + 1, 0).getDate())}`
    const monthPlanned = planned.filter(p => p.date >= firstStr && p.date <= lastStr)

    if (!monthPlanned.length) { setMuscleDayData({}); return }

    const allNames = [...new Set(monthPlanned.flatMap(pw => (pw.exercises || []).map(e => e.name).filter(Boolean)))]

    if (!allNames.length) {
      const r = {}
      monthPlanned.forEach(pw => { r[pw.date] = { hasPlan: true, topMuscles: [] } })
      setMuscleDayData(r)
      return
    }

    lookupMusclesBatch(allNames).then(muscleMap => {
      const r = {}
      for (const pw of monthPlanned) {
        const exNames = (pw.exercises || []).map(e => e.name).filter(Boolean)
        r[pw.date] = { hasPlan: true, topMuscles: getTop2Muscles(exNames.map(n => muscleMap[n] ?? 'other')) }
      }
      setMuscleDayData(r)
    }).catch(() => {})
  }, [planned, monthOffset, viewMode])

  // ── Week view data ──
  const ws = getWeekStart(weekOffset)
  const we = new Date(ws); we.setDate(ws.getDate() + 6)
  const weekLabel = `${MONTHS[ws.getMonth()]} ${ws.getDate()} – ${MONTHS[we.getMonth()]} ${we.getDate()}, ${we.getFullYear()}`
  const weekDays = Array.from({ length: 7 }, (_, d) => {
    const date = new Date(ws); date.setDate(ws.getDate() + d)
    const ds = dateToStr(date)
    const pw = planned.find(p => p.date === ds)
    return { d, date, ds, isToday: ds === todayStr, pw, isDone: pw?.status === 'completed' }
  })

  // ── Month view data ──
  const { cells: monthCells, label: monthLabel } = getMonthGrid(monthOffset)

  // ── Handlers ──
  const handleDaySave = useCallback(({ name, templateId, exercises, status }) => {
    const { ds } = dayModal
    const existing = planned.find(p => p.date === ds)
    const pw = { id: existing ? existing.id : gymUUID(), date: ds, name, templateId, exercises, status }
    const next = [...(storeGet('gym_planned') || []).filter(p => p.date !== ds), pw]
    storeSet('gym_planned', next); setPlanned(next); setDayModal(null)
  }, [dayModal, planned])

  const handleDayRemove = useCallback(() => {
    const { ds } = dayModal
    const next = (storeGet('gym_planned') || []).filter(p => p.date !== ds)
    storeSet('gym_planned', next); setPlanned(next); setDayModal(null)
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
    storeSet('gym_week_tpls', wts); setWeekTpls(wts); setWeekTplModal(false)
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
    storeSet('gym_planned', p); setPlanned(p)
  }, [ws])

  const deleteWeekTpl = useCallback(wtId => {
    if (!confirm('Delete week template?')) return
    const wts = (storeGet('gym_week_tpls') || []).filter(w => w.id !== wtId)
    storeSet('gym_week_tpls', wts); setWeekTpls(wts)
  }, [])

  return (
    <div>
      {/* ── Header: nav + view toggle ── */}
      <div className="planner-header-row" style={viewMode === 'month' ? { paddingRight: 90 } : {}}>
        <div className="planner-nav-group">
          <button className="planner-nav-btn" onClick={() => viewMode === 'month' ? setMonthOffset(v => v - 1) : onWeekOffsetChange(weekOffset - 1)}>‹</button>
          <span className="planner-week-label">{viewMode === 'month' ? monthLabel : weekLabel}</span>
          <button className="planner-nav-btn" onClick={() => viewMode === 'month' ? setMonthOffset(v => v + 1) : onWeekOffsetChange(weekOffset + 1)}>›</button>
        </div>
        <div className="planner-view-toggle">
          <button className={viewMode === 'month' ? 'btn-primary' : 'btn-secondary'} style={{ fontSize: '0.8125rem', padding: '5px 11px' }} onClick={() => setViewMode('month')}>Month</button>
          <button className={viewMode === 'week' ? 'btn-primary' : 'btn-secondary'} style={{ fontSize: '0.8125rem', padding: '5px 11px' }} onClick={() => setViewMode('week')}>Week</button>
        </div>
      </div>

      {viewMode === 'month' ? (
        <>
          {/* Day-of-week header row */}
          <div className="planner-month-dow-row">
            {DSHORT.map(d => <div key={d} className="planner-month-dow">{d}</div>)}
          </div>

          {/* Month grid */}
          <div className="planner-month-grid">
            {monthCells.map(({ date, ds, inMonth }) => {
              const pw = planned.find(p => p.date === ds)
              const md = muscleDayData[ds]
              const rawMuscles = md?.hasPlan ? (md.topMuscles.length ? md.topMuscles : ['other']) : []
              // Strip 'other' for visuals — show gray only when there are truly no tagged muscles
              const realMuscles = rawMuscles.filter(m => m !== 'other')
              const displayMuscles = realMuscles.length > 0 ? realMuscles : (rawMuscles.length > 0 ? ['other'] : [])
              const isToday = ds === todayStr
              const isDone = pw?.status === 'completed'
              const domColor = displayMuscles[0] ? MUSCLE_COLORS[displayMuscles[0]] : null

              return (
                <div
                  key={ds}
                  className={['planner-month-cell', !inMonth && 'other-month', isToday && 'is-today', pw && 'has-workout', isDone && 'is-completed'].filter(Boolean).join(' ')}
                  style={domColor ? { boxShadow: `0 0 0 1px ${hexToRgba(domColor, 0.4)}` } : {}}
                  onClick={(e) => {
                    if (pw && pw.exercises?.length > 0) onStartWorkout(pw.exercises, pw.id, pw.name, !!pw.templateId, e.currentTarget, domColor)
                    else setDayModal({ ds, existing: pw || null })
                  }}
                >
                  {displayMuscles.length > 0 && (
                    <div className="planner-cell-bg" style={{ background: buildCellGradient(displayMuscles) }} />
                  )}
                  <div className={`planner-month-num${isToday ? ' is-today' : ''}`}>{date.getDate()}</div>
                  {pw && (
                    <div className="planner-month-tooltip">
                      <div className="pmt-name">{pw.name || 'Workout'}</div>
                      {pw.exercises?.length > 0 && (
                        <div className="pmt-exercises">
                          {pw.exercises.slice(0, 5).map((ex, i) => <div key={i} className="pmt-ex">{ex.name}</div>)}
                          {pw.exercises.length > 5 && <div className="pmt-ex pmt-more">+{pw.exercises.length - 5} more</div>}
                        </div>
                      )}
                      {rawMuscles.length > 0 && (
                        <div className="pmt-muscles">
                          {rawMuscles.map(mg => (
                            <span key={mg} className="pmt-muscle-tag" style={{ color: MUSCLE_COLORS[mg] }}>{MUSCLE_LABELS[mg]}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Muscle color key */}
          <div className="planner-muscle-key">
            {ALL_MUSCLES.map(mg => (
              <div key={mg} className="planner-key-item">
                <div className="planner-key-blob blob-a" style={{ background: MUSCLE_COLORS[mg] }} />
                <span>{MUSCLE_LABELS[mg]}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* ── Week grid ── */}
          <div className={`planner-grid${desktopMode ? ' planner-grid--desktop' : ''}`}>
            {weekDays.map(({ d, date, ds, isToday, pw, isDone }) => (
              <div key={d} className="planner-day-col">
                <div className={`planner-day-header${isToday ? ' is-today' : ''}`}>{DSHORT[d]}</div>
                <div
                  className={`planner-day-cell${isToday ? ' is-today' : ''}${isDone ? ' is-completed' : ''}${pw && !isDone ? ' has-workout' : ''}`}
                  onClick={() => setDayModal({ ds, existing: pw || null })}
                >
                  <div className={`planner-day-num${isToday ? ' is-today' : ''}`}>{date.getDate()}</div>
                  {pw ? (
                    <>
                      <div className={`planner-workout-chip${isDone ? ' is-completed' : ''}`}>{pw.name || 'Workout'}</div>
                      {desktopMode && pw.exercises?.length > 0 && (
                        <div className="planner-day-exercises">
                          {pw.exercises.slice(0, 5).map((ex, i) => <div key={i} className="planner-day-ex-item">{ex.name}</div>)}
                          {pw.exercises.length > 5 && <div className="planner-day-ex-more">+{pw.exercises.length - 5} more</div>}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="planner-add-plus">+</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Week templates */}
          <div className="planner-week-tpl-section">
            <div className="planner-week-tpl-header" onClick={() => setWeekTplsOpen(v => !v)}>
              <div className="section-title" style={{ marginBottom: 0, flex: 1 }}>Week Templates</div>
              <span className={`planner-week-tpl-chevron${weekTplsOpen ? ' open' : ''}`}>›</span>
            </div>
            {weekTplsOpen && (
              <>
                <div className="gym-section-header" style={{ marginBottom: 12, marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Save or apply a full weekly split</div>
                  <button className="btn-secondary" onClick={() => setWeekTplModal(true)}>Save This Week</button>
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
                        <button className="btn-secondary" onClick={() => applyWeekTpl(wt.id)}>Apply to Week</button>
                        <button className="btn-ghost" style={{ color: 'var(--danger)', borderColor: 'rgba(255,107,107,0.3)' }} onClick={() => deleteWeekTpl(wt.id)}>Del</button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </>
      )}

      {dayModal && (
        <DayModal
          ds={dayModal.ds}
          existing={dayModal.existing}
          templates={templates}
          onClose={() => setDayModal(null)}
          onSave={handleDaySave}
          onRemove={handleDayRemove}
          onStartWorkout={pw => onStartWorkout(pw.exercises, pw.id, pw.name, !!pw.templateId)}
        />
      )}
      {weekTplModal && <WeekTemplateModal onClose={() => setWeekTplModal(false)} onSave={saveWeekTpl} />}
    </div>
  )
}
