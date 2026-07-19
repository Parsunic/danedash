import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { storeGet } from '../lib/storage.js'
import { getActiveDateString } from '../lib/dateHelpers.js'
import { JOURNAL_KEY, isEntryLocked } from '../modules/journal/journalUtils.js'
import { useNavModules } from '../lib/navOrder.js'
import { parseQuickAdd, describeQuickAdd, canExecute, executeQuickAdd } from '../lib/quickAdd.js'

const MAX_RESULTS = 12

// ── icons ──
function IconTask() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6.5l2 2 3.5-3.5" /><path d="M13 7h7" />
      <path d="M4 16.5l2 2 3.5-3.5" /><path d="M13 17h7" />
    </svg>
  )
}
function IconEvent() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </svg>
  )
}
function IconJournal() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}
const TASK_ICON = <IconTask />
const EVENT_ICON = <IconEvent />
const JOURNAL_ICON = <IconJournal />
const KIND_ICON = { task: TASK_ICON, 'task-tomorrow': TASK_ICON, event: EVENT_ICON, journal: JOURNAL_ICON }

// ── helpers ──
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function fmtEventHint(e) {
  const d = new Date(e.start_time)
  if (isNaN(d)) return ''
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (e.is_all_day) return day
  const h = d.getHours(), m = d.getMinutes()
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${day} · ${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`
}
function snippet(text, q, len = 72) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > len ? t.slice(0, len).trimEnd() + '…' : t
}

// Build grouped search sections (pages / tasks / events / journal). Reads storage
// fresh at call time. Empty query → pages only (avoids dumping every task).
function buildSections(query, ordered) {
  const q = query.trim().toLowerCase()

  const pageRows = ordered
    .filter(m => m.label.toLowerCase().includes(q))
    .map(m => ({ type: 'page', key: `page:${m.path}`, icon: m.icon, label: m.label, hint: 'Jump', path: m.path }))

  const sections = [{ label: 'Pages', rows: pageRows }]
  if (!q) return sections

  // tasks — today .. +7 days, undone first
  const today = getActiveDateString()
  const taskRows = []
  for (let i = 0; i <= 7; i++) {
    const ds = addDays(today, i)
    const arr = storeGet(`goals:${ds}`) || []
    if (!Array.isArray(arr)) continue
    arr.forEach((g, gi) => {
      if (g && typeof g.text === 'string' && g.text.toLowerCase().includes(q)) {
        taskRows.push({
          type: 'task', key: `task:${ds}:${g.id || gi}`, icon: TASK_ICON,
          label: g.text, done: !!g.done, offset: i,
          hint: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `+${i}d`,
        })
      }
    })
  }
  taskRows.sort((a, b) => (Number(a.done) - Number(b.done)) || (a.offset - b.offset))

  // events — title contains, within ±60 days
  const now = Date.now(), win = 60 * 86400000
  const eventRows = (storeGet('calendar_events') || [])
    .filter(e => e && typeof e.title === 'string' && e.title.toLowerCase().includes(q))
    .filter(e => { const t = new Date(e.start_time).getTime(); return Number.isFinite(t) && Math.abs(t - now) <= win })
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .map(e => ({ type: 'event', key: `event:${e.id}`, icon: EVENT_ICON, label: e.title, hint: fmtEventHint(e) }))

  // journal — unlocked entries only, text contains
  const journalRows = (storeGet(JOURNAL_KEY) || [])
    .filter(e => e && !isEntryLocked(e) && typeof e.text === 'string' && e.text.toLowerCase().includes(q))
    .map(e => ({ type: 'journal', key: `journal:${e.id}`, icon: JOURNAL_ICON, label: snippet(e.text, q), hint: e.date }))

  sections.push({ label: 'Tasks', rows: taskRows })
  sections.push({ label: 'Events', rows: eventRows })
  sections.push({ label: 'Journal', rows: journalRows })
  return sections
}

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate()
  const { ordered } = useNavModules()
  const orderedRef = useRef(ordered)
  orderedRef.current = ordered

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [flash, setFlash] = useState(null)
  const inputRef = useRef(null)

  const parsed = useMemo(() => parseQuickAdd(query), [query])
  const isCommand = !!parsed.kind

  const sections = useMemo(
    () => (isCommand ? [] : buildSections(query, orderedRef.current)),
    [query, isCommand]
  )

  // Flatten grouped sections into a capped, index-tagged list for keyboard nav.
  const { grouped, flatRows } = useMemo(() => {
    const flat = []
    const g = []
    for (const sec of sections) {
      if (flat.length >= MAX_RESULTS) break
      const take = sec.rows.slice(0, MAX_RESULTS - flat.length)
      if (!take.length) continue
      const rows = take.map(r => ({ row: r, index: flat.push(r) - 1 }))
      g.push({ label: sec.label, rows })
    }
    return { grouped: g, flatRows: flat }
  }, [sections])

  // Reset on open + focus the input.
  useEffect(() => {
    if (!open) return
    setQuery(''); setSelectedIndex(0); setFlash(null)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => { setSelectedIndex(0) }, [query])

  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 1800)
    return () => clearTimeout(id)
  }, [flash])

  const runCommand = useCallback(() => {
    if (!canExecute(parsed)) return
    const msg = executeQuickAdd(parsed)
    if (msg) { setFlash(msg); setQuery(''); setSelectedIndex(0); inputRef.current?.focus() }
  }, [parsed])

  const activate = useCallback((row) => {
    if (!row) return
    if (row.type === 'page') navigate(row.path)
    else if (row.type === 'task') navigate('/goals?view=tasks')
    else if (row.type === 'event') navigate('/calendar')
    else if (row.type === 'journal') navigate('/journal')
    onClose()
  }, [navigate, onClose])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if (isCommand) {
      if (e.key === 'Enter') { e.preventDefault(); runCommand() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(flatRows.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); activate(flatRows[selectedIndex]) }
  }, [isCommand, runCommand, flatRows, selectedIndex, activate, onClose])

  if (!open) return null

  const preview = describeQuickAdd(parsed)
  const canExec = canExecute(parsed)

  return (
    <div className="cmdp-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdp-panel" role="dialog" aria-label="Command palette">
        <div className="cmdp-input-wrap">
          <input
            ref={inputRef}
            className="cmdp-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, tasks, events — or t · tm · e · j to add"
            autoComplete="off"
            spellCheck={false}
            aria-label="Command input"
          />
        </div>

        <div className="cmdp-results">
          {flash && <div className="cmdp-flash">✓ {flash}</div>}

          {isCommand ? (
            <>
              <div className="cmdp-group-label">Quick add</div>
              <div
                className={`cmdp-row cmdp-preview-row${canExec ? ' is-selected' : ' is-disabled'}`}
                onClick={runCommand}
              >
                <span className="cmdp-row-icon">{KIND_ICON[parsed.kind]}</span>
                <span className="cmdp-row-text">{preview}</span>
                {canExec && <span className="cmdp-row-hint">Enter ↵</span>}
              </div>
            </>
          ) : grouped.length ? (
            grouped.map(sec => (
              <div key={sec.label} className="cmdp-group">
                <div className="cmdp-group-label">{sec.label}</div>
                {sec.rows.map(({ row, index }) => (
                  <div
                    key={row.key}
                    className={`cmdp-row${index === selectedIndex ? ' is-selected' : ''}${row.type === 'task' && row.done ? ' is-done' : ''}`}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => activate(row)}
                  >
                    <span className="cmdp-row-icon">{row.icon}</span>
                    <span className="cmdp-row-text">{row.label}</span>
                    {row.hint && <span className="cmdp-row-hint">{row.hint}</span>}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="cmdp-empty">
              {query.trim() ? 'No matches' : 'Jump to a page, or type t · tm · e · j to add'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
