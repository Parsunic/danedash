import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { storeGet } from '../../../lib/storage.js'
import { calcStreak, getDailyPrompt, getJournalDateString } from '../../journal/journalUtils.js'

// Journal widget — writing streak + today's prompt.
// Data: journal_entries (localStorage mirror) + calcStreak/getDailyPrompt from
// journalUtils. Journal uses a 5 AM rollover (getJournalDateString), so we date
// "written today" and the prompt against that, not the 4 AM goals rollover.
// Listens 'sync-applied' — journal_entries syncs cross-device.

const ROOT_STYLE = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
const HERO = { fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--text-primary)' }

function loadEntries() {
  return storeGet('journal_entries') || []
}

export default function JournalWidget({ size, bp }) {
  const [entries, setEntries] = useState(loadEntries)

  const refresh = useCallback(() => setEntries(loadEntries()), [])
  useEffect(() => {
    window.addEventListener('sync-applied', refresh)
    return () => window.removeEventListener('sync-applied', refresh)
  }, [refresh])

  const today = getJournalDateString()
  const streak = calcStreak(entries, today)
  const wroteToday = entries.some(e => e.date === today)

  const dot = (
    <span
      title={wroteToday ? "Today's entry saved" : 'Not written today'}
      style={{
        width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
        background: wroteToday ? 'var(--accent)' : 'transparent',
        border: wroteToday ? 'none' : '1.5px solid rgba(255,255,255,0.18)',
        boxShadow: wroteToday ? '0 0 8px rgba(232,160,32,0.7)' : 'none',
      }}
    />
  )

  const hero = (
    <>
      <div className="dash-widget-label">Journal</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 4 }}>
        <span style={{ ...HERO, fontSize: 40, lineHeight: 1 }}>{streak}</span>
        {dot}
      </div>
      <div className="dash-widget-label" style={{ marginTop: 3 }}>day streak</div>
    </>
  )

  // ── S: streak + written-today dot ──
  if (size === 'S') {
    return (
      <div style={ROOT_STYLE}>
        {hero}
        <div className="dash-widget-empty" style={{ marginTop: 'auto', padding: 0 }}>
          {wroteToday ? 'Logged for today.' : 'Take a minute to reflect.'}
        </div>
      </div>
    )
  }

  // ── M: + prompt teaser + Write link ──
  const prompt = getDailyPrompt(today)
  return (
    <div style={ROOT_STYLE}>
      <div className="dash-widget-header" style={{ marginBottom: 6 }}>
        <span className="dash-widget-label">Journal</span>
        <Link to="/journal" className="dash-widget-link">Write →</Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ ...HERO, fontSize: 34, lineHeight: 1 }}>{streak}</span>
        {dot}
        <span className="dash-widget-label">day streak</span>
      </div>
      <div
        className="dash-task-text"
        style={{
          marginTop: 'auto', fontSize: 13, lineHeight: 1.4, color: 'var(--text-secondary)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}
      >
        {wroteToday ? 'Today’s entry is in — see you tomorrow.' : `“${prompt}”`}
      </div>
    </div>
  )
}
