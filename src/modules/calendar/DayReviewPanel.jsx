import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase.js'
import { getDayEvents } from './calendarUtils.js'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtTime(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function adherenceColor(score) {
  if (score >= 70) return 'var(--success)'
  if (score >= 40) return 'var(--warning)'
  return 'var(--danger)'
}

const STATUS_META = {
  completed: { label: 'Done',     color: 'var(--success)' },
  modified:  { label: 'Modified', color: 'var(--warning)' },
  skipped:   { label: 'Skipped',  color: 'var(--danger)'  },
}

export default function DayReviewPanel({ date, events, gymPlanned, onClose }) {
  const [open, setOpen] = useState(false)
  const [rawText, setRawText] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingReview, setLoadingReview] = useState(true)
  const [review, setReview] = useState(null)
  const [pendingResults, setPendingResults] = useState(null)
  const recognitionRef = useRef(null)
  const ds = dateKey(date)

  useEffect(() => {
    requestAnimationFrame(() => setOpen(true))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoadingReview(true)
    supabase
      .from('day_reviews')
      .select('*')
      .eq('date', ds)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) { setReview(data); setRawText(data.raw_text || '') }
        setLoadingReview(false)
      })
    return () => { cancelled = true }
  }, [ds])

  const handleClose = useCallback(() => {
    setOpen(false)
    setTimeout(onClose, 270)
  }, [onClose])

  const toggleVoice = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice input is not supported in this browser.'); return }
    if (isListening) { recognitionRef.current?.stop(); return }
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    recognitionRef.current = rec
    rec.onresult = (e) => {
      let t = ''
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript
      setRawText(t)
    }
    rec.onerror = () => setIsListening(false)
    rec.onend  = () => setIsListening(false)
    rec.start()
    setIsListening(true)
  }, [isListening])

  const handleAnalyze = useCallback(async () => {
    const apiKey = localStorage.getItem('anthropic_api_key')
    if (!apiKey) { alert('Set your Anthropic API key in Settings first.'); return }
    if (!rawText.trim()) return
    setIsLoading(true)
    try {
      const dayEvs = getDayEvents(date, events, gymPlanned)
      const eventList = dayEvs.length
        ? dayEvs.map(ev =>
            `- [${ev.id}] "${ev.title}"${ev.start_time ? ` at ${fmtTime(ev.start_time)}` : ' (all-day)'}`
          ).join('\n')
        : '(no scheduled events)'

      const prompt = `You are reviewing a person's day: ${ds}.

Scheduled events:
${eventList}

What they say they did:
"${rawText}"

Analyze and match each scheduled event. Return a JSON object with exactly this shape:
{
  "event_outcomes": [
    { "eventId": "<id>", "title": "<event title>", "status": "completed|modified|skipped", "notes": "<brief note, max 10 words>" }
  ],
  "overall_adherence_score": <integer 0-100>,
  "summary": "<one motivational sentence>"
}

Rules:
- completed = done roughly as planned
- modified = done but differently (time/duration/way changed)
- skipped = not done at all
- Score 70-100 = good, 40-69 = partial, 0-39 = rough
- Include only events from the list above
- Return ONLY the JSON object, no other text`

      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const json = await resp.json()
      const text = json.content?.[0]?.text || '{}'
      const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
      setPendingResults(JSON.parse(cleaned))
    } catch (err) {
      console.error('Day review AI error:', err)
      alert('Analysis failed. Check your API key or try again.')
    } finally {
      setIsLoading(false)
    }
  }, [rawText, date, ds, events, gymPlanned])

  const handleSave = useCallback(async () => {
    if (!pendingResults) return
    const payload = {
      date: ds,
      raw_text: rawText,
      event_outcomes: pendingResults.event_outcomes ?? [],
      overall_adherence_score: pendingResults.overall_adherence_score ?? 0,
    }
    const { data, error } = review
      ? await supabase.from('day_reviews').update(payload).eq('id', review.id).select().maybeSingle()
      : await supabase.from('day_reviews').insert(payload).select().maybeSingle()
    if (!error && data) {
      setReview(data)
      setPendingResults(null)
      window.dispatchEvent(new CustomEvent('day-review-saved', { detail: { date: ds } }))
    } else if (error) {
      console.error('Save review error:', error)
      alert('Failed to save. Make sure the day_reviews table exists in Supabase.')
    }
  }, [pendingResults, review, ds, rawText])

  const results = pendingResults ?? (review ? {
    event_outcomes: review.event_outcomes,
    overall_adherence_score: review.overall_adherence_score,
    summary: null,
  } : null)
  const score = results?.overall_adherence_score ?? null
  const circ = 94.2

  return createPortal(
    <>
      <div className={`cal-review-backdrop${open ? ' open' : ''}`} onClick={handleClose} />
      <div className={`cal-review-panel${open ? ' open' : ''}`}>

        {/* ── Header ── */}
        <div className="cal-review-header">
          <div className="cal-review-header-inner">
            <div className="cal-review-header-eyebrow">Day Review</div>
            <div className="cal-review-header-date">
              {date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
          <button className="cal-review-close-btn" onClick={handleClose} aria-label="Close">&#x2715;</button>
        </div>

        {/* ── Body ── */}
        <div className="cal-review-body">
          {loadingReview ? (
            <div className="cal-review-loading">Loading&hellip;</div>
          ) : (
            <>
              {review && !pendingResults && (
                <div className="cal-review-existing-badge">
                  &#x2713;&nbsp;Reviewed &middot; {new Date(review.created_at).toLocaleDateString()}
                </div>
              )}

              <p className="cal-review-prompt-label">What did you do?</p>
              <div className="cal-review-input-wrap">
                <textarea
                  className="cal-review-textarea"
                  placeholder="Describe your day in plain language…&#10;e.g. went to the gym at 8am, skipped the afternoon call, had dinner with family."
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                  rows={5}
                />
                <button
                  className={`cal-review-voice-btn${isListening ? ' listening' : ''}`}
                  onClick={toggleVoice}
                  title={isListening ? 'Stop recording' : 'Voice input'}
                  type="button"
                >
                  {isListening ? '⏹' : '🎙'}
                </button>
              </div>

              {/* ── Results ── */}
              {results && (
                <div className="cal-review-results">
                  {score !== null && (
                    <div className="cal-review-score-card">
                      <div className="cal-review-score-ring" style={{ '--score-color': adherenceColor(score) }}>
                        <svg viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15" className="cal-review-score-track" />
                          <circle
                            cx="18" cy="18" r="15"
                            className="cal-review-score-arc"
                            strokeDasharray={circ}
                            strokeDashoffset={circ - (circ * score / 100)}
                          />
                        </svg>
                        <span className="cal-review-score-num">{score}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cal-review-score-kicker">Adherence Score</div>
                        {results.summary
                          ? <div className="cal-review-summary">&ldquo;{results.summary}&rdquo;</div>
                          : <div className="cal-review-summary-muted">Save to lock in this review.</div>
                        }
                      </div>
                    </div>
                  )}

                  {results.event_outcomes?.length > 0 && (
                    <div className="cal-review-events-section">
                      <div className="cal-review-subsection-label">Events</div>
                      <div className="cal-review-events-list">
                        {results.event_outcomes.map((eo, i) => {
                          const meta = STATUS_META[eo.status] ?? STATUS_META.skipped
                          return (
                            <div key={i} className="cal-review-event-row">
                              <span className="cal-review-status-dot" style={{ background: meta.color }} />
                              <div className="cal-review-event-info">
                                <div className="cal-review-event-title">{eo.title}</div>
                                {eo.notes && <div className="cal-review-event-notes">{eo.notes}</div>}
                              </div>
                              <span
                                className="cal-review-status-pill"
                                style={{ color: meta.color, borderColor: `${meta.color}35`, background: `${meta.color}12` }}
                              >
                                {meta.label}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="cal-review-footer">
          {pendingResults ? (
            <>
              <button className="cal-review-ghost-btn" onClick={() => setPendingResults(null)}>Discard</button>
              <button className="cal-review-primary-btn" onClick={handleSave}>Save Review</button>
            </>
          ) : (
            <button
              className="cal-review-primary-btn"
              style={{ flex: 1 }}
              onClick={handleAnalyze}
              disabled={isLoading || !rawText.trim()}
            >
              {isLoading ? 'Analyzing…' : review ? '↺ Re-analyze' : '✦ Analyze Day'}
            </button>
          )}
        </div>

      </div>
    </>,
    document.body
  )
}
