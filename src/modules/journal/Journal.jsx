import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { storeGet, storeSet } from '../../lib/storage.js'
import BackgroundBlob from '../../components/BackgroundBlob.jsx'
import { formatDate } from '../../lib/dateHelpers.js'
import {
  JOURNAL_KEY, TAGS, AI_MODELS,
  getJournalDateString, getDailyPrompt,
  isEntryLocked, lockTimeRemaining,
  calcStreak, getMonthGrid, toDateStr,
} from './journalUtils.js'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa']

// ── Helpers ──

function renderAnalysis(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return <span key={i}>{part}</span>
  })
}

// ── Icons ──

function LockIcon({ size = 13 }) {
  return (
    <svg width={size} height={Math.round(size * 1.2)} viewBox="0 0 13 16" fill="none" aria-hidden="true">
      <rect x="1" y="6.5" width="11" height="8.5" rx="2" stroke="currentColor" strokeWidth="1.4" fill="none"/>
      <path d="M3.5 6.5V4.5A3 3 0 0 1 9.5 4.5V6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="6.5" cy="10.5" r="1.2" fill="currentColor"/>
    </svg>
  )
}

// ── EntryCard ──

function EntryCard({ entry }) {
  const locked = isEntryLocked(entry)
  const remaining = locked ? lockTimeRemaining(entry) : ''
  const d = new Date(entry.created_at)
  const timeLabel = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return (
    <div className="journal-entry-card">
      <div className="journal-entry-meta">
        <span className="journal-entry-time">{timeLabel}</span>
        {entry.tags?.length > 0 && (
          <div className="journal-entry-tags">
            {entry.tags.map(t => <span key={t} className="journal-entry-tag">{t}</span>)}
          </div>
        )}
      </div>
      {locked ? (
        <div className="journal-entry-locked">
          <span className="journal-entry-lock-icon"><LockIcon size={12} /></span>
          <span>Unlocks in {remaining}</span>
        </div>
      ) : (
        <p className="journal-entry-text">{entry.text}</p>
      )}
    </div>
  )
}

// ── DayPanel (slide-over for calendar click) ──

function DayPanel({ dateStr, entries, onClose }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setOpen(true)) }, [])
  const close = () => { setOpen(false); setTimeout(onClose, 260) }
  const [y, m, d] = dateStr.split('-').map(Number)
  const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <>
      <div className={`journal-day-backdrop${open ? ' open' : ''}`} onClick={close} />
      <div className={`journal-day-panel${open ? ' open' : ''}`}>
        <div className="journal-day-panel-header">
          <span className="journal-day-panel-title">{label}</span>
          <button className="cal-modal-close" onClick={close}>✕</button>
        </div>
        <div className="journal-day-panel-body">
          {entries.length === 0 ? (
            <div className="journal-day-panel-empty">No entries for this day.</div>
          ) : (
            entries.map(e => <EntryCard key={e.id} entry={e} />)
          )}
        </div>
      </div>
    </>
  )
}

// ── MonthCalendar (heatmap grid) ──

function MonthCalendar({ entries, month, onMonthChange, onDayClick, todayStr }) {
  const year = month.getFullYear()
  const mon  = month.getMonth()
  const grid = useMemo(() => getMonthGrid(year, mon), [year, mon])

  const countsByDate = useMemo(() => {
    const map = {}
    entries.forEach(e => { map[e.date] = (map[e.date] || 0) + 1 })
    return map
  }, [entries])

  const todayMidnight = useMemo(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d
  }, [])

  const prevMonth = () => { const d = new Date(month); d.setMonth(d.getMonth() - 1); onMonthChange(d) }
  const nextMonth = () => { const d = new Date(month); d.setMonth(d.getMonth() + 1); onMonthChange(d) }

  return (
    <div>
      <div className="journal-cal-header">
        <button className="journal-cal-nav-btn" onClick={prevMonth}>‹</button>
        <span className="journal-cal-month-label">{MONTHS[mon]} {year}</span>
        <button className="journal-cal-nav-btn" onClick={nextMonth}>›</button>
      </div>

      <div className="journal-cal-dow">
        {DOW.map(d => <div key={d} className="journal-cal-dow-label">{d}</div>)}
      </div>

      <div className="journal-cal-grid">
        {grid.flat().map((cell, i) => {
          if (!cell.inMonth) return <div key={i} className="journal-cal-cell out-of-month" />

          const ds      = toDateStr(cell.date)
          const count   = countsByDate[ds] || 0
          const isToday = ds === todayStr
          const cellMid = new Date(cell.date); cellMid.setHours(0,0,0,0)
          const isPast  = cellMid < todayMidnight && !isToday
          const isMissed = isPast && count === 0

          const hasClass = count >= 3 ? 'has-3' : count === 2 ? 'has-2' : count === 1 ? 'has-1' : ''

          return (
            <div
              key={i}
              className={`journal-cal-cell${hasClass ? ' '+hasClass : ''}${isToday ? ' is-today' : ''}`}
              onClick={() => onDayClick(ds)}
              title={count ? `${count} ${count === 1 ? 'entry' : 'entries'}` : undefined}
            >
              <span className="journal-cal-date">{cell.date.getDate()}</span>
              {count > 0 && <span className="journal-cal-count">{count}</span>}
              {isMissed && <span className="journal-cal-missed-dot" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Journal page ──

export default function Journal() {
  const [entries, setEntries] = useState(() => storeGet(JOURNAL_KEY) || [])
  const [text, setText] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [aiPrompt, setAiPrompt] = useState(null)
  const [generatingPrompt, setGeneratingPrompt] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const [calMonth, setCalMonth] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState(null)
  const [lockTick, setLockTick] = useState(0)
  const textareaRef = useRef(null)

  const todayStr = getJournalDateString()
  const prompt   = aiPrompt || getDailyPrompt(todayStr)
  const isDirty  = text.trim().length > 0
  const streak   = useMemo(() => calcStreak(entries, todayStr), [entries, todayStr])

  // Refresh lock timers every 30s
  useEffect(() => {
    const id = setInterval(() => setLockTick(n => n + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const saveEntry = useCallback(() => {
    if (!text.trim()) return
    const newEntry = {
      id: crypto.randomUUID(),
      date: todayStr,
      created_at: new Date().toISOString(),
      text: text.trim(),
      tags: [...selectedTags],
      prompt,
    }
    const updated = [newEntry, ...entries]
    storeSet(JOURNAL_KEY, updated)
    setEntries(updated)
    setText('')
    setSelectedTags([])
    setAiPrompt(null)
    textareaRef.current?.focus()
  }, [text, selectedTags, prompt, entries, todayStr])

  const toggleTag = useCallback((tag) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }, [])

  const generateAIPrompt = useCallback(async () => {
    const apiKey = localStorage.getItem('anthropic_api_key') || ''
    if (!apiKey || generatingPrompt) return
    setGeneratingPrompt(true)
    const model = AI_MODELS[Math.floor(Math.random() * AI_MODELS.length)]
    try {
      const recentTexts = entries
        .filter(e => !isEntryLocked(e))
        .slice(0, 4)
        .map(e => e.text.slice(0, 150))
        .join('\n---\n')
      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 100,
          messages: [{
            role: 'user',
            content: `Write a single short journaling prompt for tonight. It should be introspective, honest, and open-ended — the kind that helps someone actually think. Return ONLY the prompt text, no quotes, no explanation.\n\nContext from recent entries:\n${recentTexts || '(none yet)'}`,
          }],
        }),
      })
      const data = await resp.json()
      if (!data.error) setAiPrompt(data.content[0].text.trim())
    } catch (e) {
      console.error('[Journal AI]', e)
    } finally {
      setGeneratingPrompt(false)
    }
  }, [entries, generatingPrompt])

  const allSortedEntries = useMemo(() =>
    [...entries].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [entries]
  )

  const dayPanelEntries = useMemo(() =>
    entries
      .filter(e => e.date === selectedDay)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [entries, selectedDay]
  )

  return (
    <div className="journal-root">
      <BackgroundBlob page="journal" />

      {/* Left col: write area */}
      <div className="journal-left-col">
        <div className="journal-eyebrow">TODAY'S REFLECTION</div>

        <h1 className="journal-date-heading">{formatDate(todayStr)}</h1>

        {/* Streak */}
        <div className="journal-streak-row">
          {streak > 0 ? (
            <>
              <span className="journal-streak-num">{streak}</span>
              <span className="journal-streak-label">day streak</span>
            </>
          ) : (
            <span className="journal-streak-empty">Start your streak today</span>
          )}
        </div>

        {/* Prompt */}
        <div className="journal-prompt-row">
          <p className="journal-prompt-text">{prompt}</p>
          <button
            className="journal-ai-prompt-btn"
            onClick={generateAIPrompt}
            disabled={generatingPrompt}
            title="Generate a new prompt with AI"
          >
            {generatingPrompt ? '…' : '✦'}
          </button>
        </div>

        {/* Write area */}
        <textarea
          ref={textareaRef}
          className="journal-textarea"
          placeholder="What's on your mind?"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) saveEntry() }}
        />

        {/* Tags */}
        <div className="journal-tag-row">
          {TAGS.map(tag => (
            <button
              key={tag}
              className={`journal-tag-pill${selectedTags.includes(tag) ? ' active' : ''}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Save — only when there's content */}
        {isDirty && (
          <button className="journal-save-btn" onClick={saveEntry}>
            Save entry
          </button>
        )}

        {/* Past reflections */}
        {allSortedEntries.length > 0 && (
          <>
            <button className="journal-past-toggle" onClick={() => setShowPast(v => !v)}>
              <span>Past reflections ({allSortedEntries.length})</span>
              <span className={`journal-past-chevron${showPast ? ' open' : ''}`}>›</span>
            </button>

            {showPast && (
              <div className="journal-past-list">
                {(() => {
                  let lastDate = null
                  return allSortedEntries.map(entry => {
                    const isNewDate = entry.date !== lastDate
                    lastDate = entry.date
                    const dateLabel = entry.date === todayStr ? 'Today' : formatDate(entry.date)
                    return (
                      <div key={`${entry.id}-${lockTick}`}>
                        {isNewDate && <div className="journal-past-date-label">{dateLabel}</div>}
                        <EntryCard entry={entry} />
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {/* Right col: calendar heatmap */}
      <div className="journal-cal-section">
        <div className="journal-cal-section-header">
          <span className="journal-eyebrow" style={{ marginBottom: 0 }}>ENTRIES</span>
        </div>
        <MonthCalendar
          entries={entries}
          month={calMonth}
          onMonthChange={setCalMonth}
          onDayClick={setSelectedDay}
          todayStr={todayStr}
        />
      </div>

      {/* Day slide-over */}
      {selectedDay && (
        <DayPanel
          dateStr={selectedDay}
          entries={dayPanelEntries}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  )
}
