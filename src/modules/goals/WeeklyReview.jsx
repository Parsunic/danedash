import { useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { storeGet, storeSet } from '../../lib/storage.js'
import {
  weekBounds, aggregateWeek, undoneGoals, nextMondayStr,
} from './weeklyReviewUtils.js'

// Weekly Review overlay (B5) — pure data, no AI. Reviews LAST week (offset -1):
// Part 1 recaps the numbers in the big-number → whisper-label → voice hierarchy;
// Part 2 turns the page — push last week's unfinished goals to the coming Monday,
// quick-add goals for the new week, and jump to Gym/Calendar to plan. "Mark week
// reviewed" persists to `weekly_reviews_v1`. Rendered through a portal so the
// fixed overlay is immune to any card-grid ancestor transforms.

const DOMAIN_COLORS = {
  fitness: '#E8A020', sleep: '#7048E8', mental: '#6BE3A4',
  learning: '#1971C2', academics: '#F2C063', other: 'rgba(255,255,255,0.4)',
}
const domainColor = (d) => DOMAIN_COLORS[d] ?? 'rgba(255,255,255,0.4)'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function fmtDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

function weekVoice(pct) {
  if (pct >= 80) return "A week you'd repeat."
  if (pct >= 55) return 'Solid ground. Build on it.'
  if (pct >= 40) return 'Some wins in there. Keep the thread.'
  return 'New week, clean slate.'
}

const WEEK_REVIEWS_KEY = 'weekly_reviews_v1'

export default function WeeklyReview({ onClose }) {
  const navigate = useNavigate()
  const bounds = useMemo(() => weekBounds(-1), [])
  const data = useMemo(() => aggregateWeek(bounds), [bounds])
  const pending = useMemo(() => undoneGoals(bounds), [bounds])
  const monday = useMemo(() => nextMondayStr(), [])

  const [pushed, setPushed] = useState(false)
  const [addText, setAddText] = useState('')
  const [addedCount, setAddedCount] = useState(0)
  const reviews = storeGet(WEEK_REVIEWS_KEY) || {}
  const [reviewed, setReviewed] = useState(!!reviews[bounds.key])

  const { goals, habits, gym, journal, calendar } = data

  // ── Part 2 gestures (all single storeSet writes) ──
  const pushToMonday = useCallback(() => {
    if (pushed || pending.length === 0) return
    const key = 'goals:' + monday
    const existing = storeGet(key) || []
    const have = new Set(existing.map(g => g && g.id).filter(Boolean))
    const additions = pending
      .filter(g => !have.has(g.id))
      .map(g => ({ id: g.id, text: g.text, done: false, date: monday }))
    storeSet(key, [...existing, ...additions])
    setPushed(true)
  }, [pushed, pending, monday])

  const addGoal = useCallback(() => {
    const text = addText.trim()
    if (!text) return
    const key = 'goals:' + monday
    const existing = storeGet(key) || []
    const id = (crypto?.randomUUID?.() || String(Date.now() + Math.random()))
    storeSet(key, [...existing, { id, text, done: false, date: monday }])
    setAddText('')
    setAddedCount(c => c + 1)
  }, [addText, monday])

  const markReviewed = useCallback(() => {
    const cur = storeGet(WEEK_REVIEWS_KEY) || {}
    storeSet(WEEK_REVIEWS_KEY, { ...cur, [bounds.key]: { completed_at: new Date().toISOString() } })
    setReviewed(true)
    onClose()
  }, [bounds.key, onClose])

  const go = useCallback((path) => { onClose(); navigate(path) }, [navigate, onClose])

  const overlay = (
    <div className="settings-backdrop wkr-backdrop" onClick={onClose}>
      <div className="wkr-panel" onClick={e => e.stopPropagation()}>
        <div className="wkr-head">
          <div>
            <div className="wkr-title">Weekly review</div>
            <div className="page-subtitle wkr-range">{fmtDay(bounds.start)} – {fmtDay(bounds.end)}</div>
          </div>
          <button className="settings-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="wkr-body">
          {/* ── PART 1 — THE WEEK ── */}
          <div className="wkr-section-label">The week</div>

          <div className="wkr-hero">
            <div className="wkr-hero-num">{goals.pct}<span className="wkr-hero-unit">%</span></div>
            <div className="wkr-hero-label">goals done</div>
            <div className="wkr-voice">{weekVoice(goals.pct)}</div>
            <div className="wkr-bars" role="img" aria-label={`${goals.done} of ${goals.total} goals completed`}>
              {goals.byDay.map((b, i) => (
                <div className="wkr-bar-col" key={b.date}>
                  <div className="wkr-bar-track">
                    <div
                      className="wkr-bar-fill"
                      style={{ height: `${Math.round((b.total ? b.done / b.total : 0) * 100)}%`, opacity: b.total ? 1 : 0.15 }}
                    />
                  </div>
                  <span className="wkr-bar-letter">{DAY_LETTERS[i]}</span>
                </div>
              ))}
            </div>
            <div className="wkr-hero-sub">{goals.done} of {goals.total} tasks across the week</div>
          </div>

          <div className="wkr-stat-grid">
            <div className="wkr-stat">
              <div className="wkr-stat-num">{habits.adherencePct == null ? '—' : `${habits.adherencePct}%`}</div>
              <div className="wkr-stat-label">habit adherence</div>
              {habits.perHabit.length > 0 && (
                <div className="wkr-habit-rows">
                  {habits.perHabit.slice(0, 4).map(h => (
                    <div className="wkr-habit-row" key={h.id}>
                      <span className="wkr-habit-dot" style={{ background: domainColor(h.domain) }} />
                      <span className="wkr-habit-name">{h.name}</span>
                      <span className="wkr-habit-count">{h.completed}/{h.target}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="wkr-stat">
              <div className="wkr-stat-num">{gym.sessions}</div>
              <div className="wkr-stat-label">gym sessions</div>
              <div className="wkr-stat-meta">
                {gym.volume > 0 ? `${gym.volume.toLocaleString()} volume` : 'no volume logged'}
                {gym.prCount > 0 && <span className="wkr-pr"> · {gym.prCount} PR{gym.prCount > 1 ? 's' : ''}</span>}
              </div>
            </div>

            <div className="wkr-stat">
              <div className="wkr-stat-num">{journal.entries}</div>
              <div className="wkr-stat-label">journal {journal.entries === 1 ? 'entry' : 'entries'}</div>
              <div className="wkr-stat-meta">{journal.avgMood != null ? `avg mood ${journal.avgMood}` : 'no mood logged'}</div>
            </div>

            <div className="wkr-stat">
              <div className="wkr-stat-num">{calendar.events}</div>
              <div className="wkr-stat-label">{calendar.events === 1 ? 'event' : 'events'}</div>
              <div className="wkr-stat-meta">on the calendar</div>
            </div>
          </div>

          {/* ── PART 2 — NEXT WEEK ── */}
          <div className="wkr-section-label wkr-section-label--next">Next week</div>

          <button
            className="btn-secondary wkr-push"
            onClick={pushToMonday}
            disabled={pushed || pending.length === 0}
          >
            {pushed
              ? 'Pushed to Monday ✓'
              : pending.length === 0
                ? 'Nothing left unfinished'
                : `Push ${pending.length} unfinished to Monday`}
          </button>

          <div className="wkr-add-row">
            <input
              className="settings-input wkr-add-input"
              type="text"
              value={addText}
              onChange={e => setAddText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addGoal() }}
              placeholder="Add a goal for the week…"
            />
            <button className="btn-secondary wkr-add-btn" onClick={addGoal} disabled={!addText.trim()}>Add</button>
          </div>
          {addedCount > 0 && (
            <div className="wkr-added-hint">{addedCount} added to Monday {fmtDay(monday)}.</div>
          )}

          <div className="wkr-links">
            <button className="btn-ghost wkr-link" onClick={() => go('/gym')}>Plan workouts →</button>
            <button className="btn-ghost wkr-link" onClick={() => go('/calendar')}>Open calendar →</button>
          </div>

          <button className="btn-primary wkr-done" onClick={markReviewed}>
            {reviewed ? 'Reviewed ✓' : 'Mark week reviewed'}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
