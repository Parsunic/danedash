import { useState, useEffect, useCallback } from 'react'
import { storeGet } from '../../lib/storage.js'
import { getActiveDateString } from '../../lib/dateHelpers.js'
import { weekBounds, aggregateWeek } from './weeklyReviewUtils.js'
import WeeklyReview from './WeeklyReview.jsx'

// Weekly Review card (area 'goals'). Chromeless like its sibling Goals cards —
// renders its own section label, voice micro-copy and a `.wkr-card` glass surface
// inside `.dc-goals-cell`. Shows LAST week's headline goal-completion % and whether
// the week has been reviewed (from `weekly_reviews_v1`); the "Review week →" btn-ghost
// opens the full-screen WeeklyReview overlay. L adds per-day bars + habit adherence.

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function load() {
  const bounds = weekBounds(-1)
  const data = aggregateWeek(bounds)
  const reviews = storeGet('weekly_reviews_v1') || {}
  return { bounds, data, reviewed: !!reviews[bounds.key] }
}

// Sun/Mon before a review reads as a gentle nudge; otherwise a neutral prompt.
function promptVoice() {
  const [y, m, d] = getActiveDateString().split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() // 0=Sun … 6=Sat
  if (dow === 0) return 'Sunday. Close out the week.'
  if (dow === 1) return 'Fresh week. Look back before you leap.'
  return 'A quiet minute to read last week honestly.'
}

export default function WeeklyReviewCard({ size, bp }) {
  const [{ bounds, data, reviewed }, setState] = useState(load)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(() => setState(load()), [])
  useEffect(() => {
    window.addEventListener('goals-changed', refresh)
    window.addEventListener('gym-changed', refresh)
    window.addEventListener('sync-applied', refresh)
    return () => {
      window.removeEventListener('goals-changed', refresh)
      window.removeEventListener('gym-changed', refresh)
      window.removeEventListener('sync-applied', refresh)
    }
  }, [refresh])

  const { goals, habits } = data
  const isL = size === 'L'
  const wide = bp !== 'mobile'
  const maxDay = Math.max(1, ...goals.byDay.map(b => b.total))

  return (
    <div className="dc-goals-cell">
      <div className="goals-section-label">Weekly Review</div>
      <div className="wkr-card-micro">
        {reviewed ? 'Last week, read and closed.' : promptVoice()}
      </div>

      <div className={`wkr-card${isL && wide ? ' wkr-card--wide' : ''}`}>
        <div className="wkr-card-main">
          <div className="wkr-card-hero">
            <span className="wkr-card-num">{goals.pct}<span className="wkr-card-pct">%</span></span>
            <span className="wkr-card-heronote">goals done last week</span>
          </div>

          {reviewed ? (
            <span className="wkr-card-badge">reviewed ✓</span>
          ) : (
            <div className="wkr-card-cta-wrap">
              <span className="wkr-card-notyet">Not reviewed yet</span>
              <button className="btn-ghost wkr-card-cta" onClick={() => setOpen(true)}>Review week →</button>
            </div>
          )}
        </div>

        {isL && (
          <div className="wkr-card-detail">
            <div className="wkr-card-bars">
              {goals.byDay.map((b, i) => (
                <div className="wkr-card-bar-col" key={b.date}>
                  <div className="wkr-card-bar-track">
                    <div
                      className="wkr-card-bar-fill"
                      style={{ height: `${Math.round((b.total ? b.done / b.total : 0) * 100)}%`, opacity: b.total ? 1 : 0.15 }}
                    />
                  </div>
                  <span className="wkr-card-bar-letter">{DAY_LETTERS[i]}</span>
                </div>
              ))}
            </div>
            <div className="wkr-card-adherence">
              <span className="wkr-card-adh-num">{habits.adherencePct == null ? '—' : `${habits.adherencePct}%`}</span>
              <span className="wkr-card-adh-label">habit adherence</span>
            </div>
          </div>
        )}

        {isL && reviewed && (
          <button className="btn-ghost wkr-card-cta wkr-card-cta--reviewed" onClick={() => setOpen(true)}>Review week →</button>
        )}
      </div>

      {open && <WeeklyReview onClose={() => { setOpen(false); refresh() }} />}
    </div>
  )
}
