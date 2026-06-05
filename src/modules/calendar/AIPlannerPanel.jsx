import { useState, useRef, useCallback, useEffect } from 'react'
import { supabase } from '../../lib/supabase.js'
import { JOURNAL_KEY } from '../journal/journalUtils.js'

// Required Supabase table (run once):
// CREATE TABLE user_context (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id text NOT NULL DEFAULT 'dane',
//   goals text,
//   created_at timestamptz DEFAULT now()
// );

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const USER_ID = 'dane'

function getEventsInRange(allEvents, fromDate, toDate) {
  return allEvents.filter(ev => {
    const s = new Date(ev.start_time)
    return s >= fromDate && s <= toDate
  }).sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
}

function formatEventsForPrompt(events) {
  if (!events.length) return 'None'
  return events.map(ev => {
    const s = new Date(ev.start_time)
    const e = new Date(ev.end_time)
    const dateStr = s.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    const startStr = s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    const endStr   = e.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    return `- ${dateStr}, ${startStr}–${endStr}: ${ev.title}${ev.description ? ` (${ev.description})` : ''}`
  }).join('\n')
}

function formatTime(iso) {
  const d = new Date(iso)
  const h = d.getHours(), m = d.getMinutes()
  const ap = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`
}

function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function nDaysAgoStr(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// ── Fetch rich context for Optimize mode ──
async function fetchOptimizeContext() {
  const sevenDaysAgo = nDaysAgoStr(7)

  const [journalResult, reviewsResult, healthResult, goalsResult] = await Promise.allSettled([
    // Journal entries from localStorage
    Promise.resolve(
      (JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5)
    ),
    // Day reviews from Supabase
    supabase
      .from('day_reviews')
      .select('date, overall_adherence_score, raw_text, event_outcomes')
      .gte('date', sevenDaysAgo)
      .order('date', { ascending: false }),
    // Health metrics from Supabase
    supabase
      .from('health_metrics')
      .select('date, sleep_score, hrv')
      .eq('user_id', USER_ID)
      .gte('date', sevenDaysAgo)
      .order('date', { ascending: false }),
    // User goals from Supabase
    supabase
      .from('user_context')
      .select('goals')
      .eq('user_id', USER_ID)
      .maybeSingle(),
  ])

  return {
    journals:  journalResult.status === 'fulfilled' ? journalResult.value : [],
    dayReviews: reviewsResult.status === 'fulfilled' ? (reviewsResult.value.data ?? []) : [],
    health:    healthResult.status === 'fulfilled' ? (healthResult.value.data ?? []) : [],
    goals:     goalsResult.status === 'fulfilled' ? (goalsResult.value.data?.goals ?? '') : '',
  }
}

function buildOptimizeContextBlock({ journals, dayReviews, health, goals }) {
  const lines = []

  if (goals) {
    lines.push(`## User's Goals\n${goals}`)
  }

  if (health.length) {
    lines.push('## Recent Health Data (last 7 days)')
    health.forEach(h => {
      const parts = [`${h.date}`]
      if (h.sleep_score != null) parts.push(`Sleep score: ${h.sleep_score}/100`)
      if (h.hrv != null)         parts.push(`HRV: ${Math.round(h.hrv)}ms`)
      lines.push('- ' + parts.join(' | '))
    })
  }

  if (dayReviews.length) {
    lines.push('## Adherence History (last 7 days)')
    dayReviews.forEach(r => {
      const score = r.overall_adherence_score != null ? `${r.overall_adherence_score}% adherence` : 'no score'
      const note = r.raw_text ? ` — "${r.raw_text.slice(0, 120)}${r.raw_text.length > 120 ? '…' : ''}"` : ''
      lines.push(`- ${r.date}: ${score}${note}`)
    })
  }

  if (journals.length) {
    lines.push('## Recent Journal Entries (last 5)')
    journals.forEach(j => {
      const date = j.date || j.created_at?.slice(0, 10) || ''
      const excerpt = (j.content || j.text || '').slice(0, 200)
      if (excerpt) lines.push(`- ${date}: "${excerpt}${excerpt.length === 200 ? '…' : ''}"`)
    })
  }

  return lines.join('\n\n')
}

export default function AIPlannerPanel({ events, gymPlanned, onEventsAdd, onClose }) {
  const [open, setOpen]             = useState(false)
  const [tab, setTab]               = useState('plan')
  const [planMode, setPlanMode]     = useState('execute')
  const [planInput, setPlanInput]   = useState('')
  const [reviewMode, setReviewMode] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [status, setStatus]         = useState(null)
  const [proposed, setProposed]     = useState(null)
  const [reasoning, setReasoning]   = useState(null)
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const [messages, setMessages]     = useState([])
  const [askInput, setAskInput]     = useState('')
  const [streaming, setStreaming]   = useState(false)
  // Optimize mode: user goals (loaded + editable)
  const [goals, setGoals]           = useState('')
  const [goalsSaving, setGoalsSaving] = useState(false)
  const [goalsLoaded, setGoalsLoaded] = useState(false)
  const messagesEndRef = useRef(null)
  const askInputRef    = useRef(null)

  useEffect(() => { requestAnimationFrame(() => setOpen(true)) }, [])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Load goals when switching to optimize mode
  useEffect(() => {
    if (planMode !== 'optimize' || goalsLoaded) return
    supabase.from('user_context').select('goals').eq('user_id', USER_ID).maybeSingle()
      .then(({ data }) => { if (data?.goals) setGoals(data.goals) })
      .catch(() => {})
      .finally(() => setGoalsLoaded(true))
  }, [planMode, goalsLoaded])

  const handleClose = () => { setOpen(false); setTimeout(onClose, 260) }

  const getApiKey = () => {
    const key = localStorage.getItem('anthropic_api_key') || ''
    if (!key) setStatus({ type: 'error', text: 'API key not set — open Settings ⚙ and add your Anthropic key.' })
    return key
  }

  const saveGoals = useCallback(async () => {
    setGoalsSaving(true)
    try {
      const { data: existing } = await supabase.from('user_context').select('id').eq('user_id', USER_ID).maybeSingle()
      if (existing) {
        await supabase.from('user_context').update({ goals }).eq('user_id', USER_ID)
      } else {
        await supabase.from('user_context').insert({ user_id: USER_ID, goals })
      }
    } catch (e) {
      console.error('[Goals save]', e)
    } finally {
      setGoalsSaving(false)
    }
  }, [goals])

  const buildBaseContext = useCallback(() => {
    const now = new Date()
    const past7  = new Date(now); past7.setDate(now.getDate() - 7)
    const next14 = new Date(now); next14.setDate(now.getDate() + 14)
    const pastEvs   = getEventsInRange(events, past7, now)
    const futureEvs = getEventsInRange(events, now, next14)
    const todayStr  = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const timeStr   = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

    return `Today is ${todayStr}. Current time: ${timeStr} (${now.toISOString()}).

SCHEDULING CONSTRAINTS (hard rules):
- Never schedule before 6:30 AM or after 9:30 PM.
- Target wake: 6:30 AM; hard limit on school days: 6:45 AM.
- Target sleep: 9:30 PM; prefer 8+ hours of sleep.

Existing events — next 14 days:
${formatEventsForPrompt(futureEvs)}

Recent events — last 7 days (for pattern context):
${formatEventsForPrompt(pastEvs)}

Available category colors:
#E03131 Routine · #E8590C Personal · #F59F00 Transportation
#2F9E44 Hygiene · #1971C2 Work · #7048E8 School · #868E96 Other`
  }, [events])

  const EXECUTE_SYSTEM = `You are a strict scheduling executor.
Schedule ONLY what the user explicitly states — nothing more.
Never infer, suggest, or add anything not directly requested.
No buffer tasks, no assumptions, no extras.

Return ONLY valid JSON — no markdown fences, no explanation — in this exact format:
{"summary":"<what you scheduled>","events":[{"title":"Event name","date":"YYYY-MM-DD","start_time":"HH:MM","end_time":"HH:MM","color":"#hex","description":"Optional notes"}]}

Rules: date YYYY-MM-DD · times 24-hour HH:MM · do not overlap existing events · assign fitting color per event type`

  const OPTIMIZE_SYSTEM = `You are an intelligent day optimizer with deep context about the user's health, habits, and goals.

Design a schedule that:
- Places hard cognitive tasks during peak energy windows (avoid after HRV < 40ms or sleep score < 60)
- Inserts recovery buffers (10–15 min walks, breaks) after intense 90+ min focus blocks
- Learns from past skipped events — don't reschedule patterns that consistently fail
- Sequences tasks by cognitive load: creative/analytical work first, admin/logistics last
- Respects the user's stated goals and what they journal about

Return ONLY valid JSON — no markdown fences — in this exact format:
{"summary":"<brief summary>","reasoning":"<2-3 sentences explaining the cognitive sequencing and energy considerations>","events":[{"title":"Event name","date":"YYYY-MM-DD","start_time":"HH:MM","end_time":"HH:MM","color":"#hex","description":"Optional notes"}]}

Rules: date YYYY-MM-DD · times 24-hour HH:MM · do not overlap existing events · assign fitting color per event type`

  const handlePlan = useCallback(async () => {
    if (!planInput.trim()) return
    const apiKey = getApiKey()
    if (!apiKey) return

    setLoading(true)
    setStatus({ type: 'info', text: planMode === 'optimize' ? 'Analyzing your data and optimizing…' : 'Planning your schedule…' })
    setProposed(null)
    setReasoning(null)

    try {
      const baseContext = buildBaseContext()
      let fullContext = baseContext

      if (planMode === 'optimize') {
        const richData = await fetchOptimizeContext()
        const richBlock = buildOptimizeContextBlock(richData)
        if (richBlock) fullContext = `${baseContext}\n\n${richBlock}`
      }

      const systemPrompt = planMode === 'optimize' ? OPTIMIZE_SYSTEM : EXECUTE_SYSTEM
      const userMessage  = `${fullContext}\n\nUser request: ${planInput.trim()}`

      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })

      const data = await resp.json()
      if (data.error) throw new Error(data.error.message)

      let raw = data.content[0].text.trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      const parsed = JSON.parse(raw)

      if (parsed.reasoning) setReasoning(parsed.reasoning)

      const newEvents = (parsed.events || []).map(ev => ({
        id: crypto.randomUUID(),
        user_id: USER_ID,
        title: ev.title,
        description: ev.description || '',
        start_time: new Date(`${ev.date}T${ev.start_time}`).toISOString(),
        end_time:   new Date(`${ev.date}T${ev.end_time}`).toISOString(),
        color: ev.color || '#868E96',
        is_all_day: false,
        created_at: new Date().toISOString(),
      }))

      if (reviewMode) {
        setProposed({ events: newEvents, summary: parsed.summary || `Proposed ${newEvents.length} event(s)` })
        setStatus({ type: 'info', text: parsed.summary || `Proposed ${newEvents.length} event(s) — review below` })
      } else {
        onEventsAdd(newEvents)
        setStatus({ type: 'success', text: parsed.summary || `Added ${newEvents.length} event(s) to your calendar` })
        setPlanInput('')
      }
    } catch (e) {
      console.error('[AI Planner]', e)
      setStatus({ type: 'error', text: 'Planning failed: ' + (e.message || 'unknown error') })
    } finally {
      setLoading(false)
    }
  }, [planInput, planMode, reviewMode, buildBaseContext, onEventsAdd])

  const confirmProposed = useCallback(() => {
    if (!proposed) return
    onEventsAdd(proposed.events)
    setStatus({ type: 'success', text: `Added ${proposed.events.length} event(s) to your calendar` })
    setProposed(null)
    setPlanInput('')
  }, [proposed, onEventsAdd])

  const buildAskContext = useCallback(() => {
    const now = new Date()
    const past7  = new Date(now); past7.setDate(now.getDate() - 7)
    const next30 = new Date(now); next30.setDate(now.getDate() + 30)
    const relevant = getEventsInRange(events, past7, next30)
    const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const timeStr  = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    return `Today is ${todayStr}. Current time: ${timeStr}.\n\nUser's calendar (last 7 days + next 30 days):\n${formatEventsForPrompt(relevant)}`
  }, [events])

  const handleAsk = useCallback(async () => {
    if (!askInput.trim() || streaming) return
    const apiKey = getApiKey()
    if (!apiKey) return

    const userMsg = { role: 'user', content: askInput.trim() }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '' }])
    setAskInput('')
    setStreaming(true)

    try {
      const context = buildAskContext()
      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          stream: true,
          system: `You are a helpful calendar assistant. Answer questions about the user's schedule concisely and conversationally.\n\n${context}`,
          messages: history,
        }),
      })

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value, { stream: true }).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const ev = JSON.parse(payload)
            if (ev.type === 'content_block_delta' && ev.delta?.text) {
              accumulated += ev.delta.text
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: accumulated }
                return updated
              })
            }
          } catch {}
        }
      }
    } catch (e) {
      console.error('[AI Ask]', e)
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Something went wrong. Please try again.' }
        return updated
      })
    } finally {
      setStreaming(false)
      setTimeout(() => askInputRef.current?.focus(), 50)
    }
  }, [askInput, messages, streaming, buildAskContext])

  return (
    <>
      <div className={`ai-planner-backdrop${open ? ' open' : ''}`} onClick={handleClose} />
      <div className={`ai-planner-panel${open ? ' open' : ''}`}>

        {/* Header */}
        <div className="ai-planner-header">
          <div>
            <div className="ai-planner-eyebrow">AI PLANNER</div>
            <div className="ai-planner-tabs">
              <button className={`ai-planner-tab${tab === 'plan' ? ' active' : ''}`} onClick={() => setTab('plan')}>Plan</button>
              <button className={`ai-planner-tab${tab === 'ask' ? ' active' : ''}`} onClick={() => setTab('ask')}>Ask</button>
            </div>
          </div>
          <button className="cal-modal-close" onClick={handleClose}>✕</button>
        </div>

        {/* Plan mode */}
        {tab === 'plan' && (
          <div className="ai-planner-plan">
            {/* Mode pill switcher */}
            <div className="ai-mode-switcher">
              <button
                className={`ai-mode-pill${planMode === 'execute' ? ' active' : ''}`}
                onClick={() => setPlanMode('execute')}
              >
                Execute
              </button>
              <button
                className={`ai-mode-pill${planMode === 'optimize' ? ' active' : ''}`}
                onClick={() => setPlanMode('optimize')}
              >
                ✦ Optimize My Day
              </button>
            </div>

            {planMode === 'execute' ? (
              <p className="ai-planner-hint">
                Tell me exactly what to schedule. I'll add it precisely — no extras, no assumptions.
              </p>
            ) : (
              <>
                <p className="ai-planner-hint">
                  I'll pull your health data, journal entries, and past adherence to build a schedule optimized for your energy and goals.
                </p>
                <div className="ai-goals-block">
                  <div className="ai-goals-label">YOUR GOALS</div>
                  <textarea
                    className="ai-goals-input"
                    placeholder="e.g. Improve sleep consistency, finish AP Chemistry by June, get to the gym 4x/week, reduce screen time after 8pm…"
                    value={goals}
                    onChange={e => setGoals(e.target.value)}
                    rows={3}
                  />
                  <button
                    className="ai-goals-save-btn"
                    onClick={saveGoals}
                    disabled={goalsSaving}
                  >
                    {goalsSaving ? 'Saving…' : 'Save Goals'}
                  </button>
                </div>
              </>
            )}

            <textarea
              className="ai-planner-textarea"
              placeholder={
                planMode === 'execute'
                  ? 'e.g. "Block 2-hour study sessions for my chemistry exam on Friday, leaving evenings free after 8pm."'
                  : 'e.g. "Plan tomorrow" or "Optimize the rest of this week around my gym sessions."'
              }
              value={planInput}
              onChange={e => setPlanInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handlePlan() }}
              rows={4}
              disabled={loading}
            />

            <label className="ai-planner-review-row">
              <span className="ai-planner-review-label">Review before adding</span>
              <button
                type="button"
                className={`ai-planner-toggle${reviewMode ? ' on' : ''}`}
                onClick={() => setReviewMode(v => !v)}
                aria-label="Toggle review mode"
              />
            </label>

            {status && (
              <div className={`ai-planner-status ${status.type}`}>{status.text}</div>
            )}

            {/* Reasoning collapsible (Optimize mode only) */}
            {reasoning && (
              <div className="ai-reasoning-block">
                <button
                  className="ai-reasoning-toggle"
                  onClick={() => setReasoningOpen(v => !v)}
                >
                  <span>Why I planned it this way</span>
                  <span className={`ai-reasoning-chevron${reasoningOpen ? ' open' : ''}`}>›</span>
                </button>
                {reasoningOpen && (
                  <div className="ai-reasoning-body">{reasoning}</div>
                )}
              </div>
            )}

            {proposed && (
              <div className="ai-planner-proposed">
                <div className="ai-planner-proposed-label">PROPOSED EVENTS</div>
                {proposed.events.map(ev => (
                  <div key={ev.id} className="ai-planner-proposed-event">
                    <span className="ai-planner-proposed-dot" style={{ background: ev.color }} />
                    <div className="ai-planner-proposed-info">
                      <div className="ai-planner-proposed-name">{ev.title}</div>
                      <div className="ai-planner-proposed-time">
                        {formatDateShort(ev.start_time)} · {formatTime(ev.start_time)}–{formatTime(ev.end_time)}
                      </div>
                      {ev.description && <div className="ai-planner-proposed-desc">{ev.description}</div>}
                    </div>
                  </div>
                ))}
                <div className="ai-planner-proposed-actions">
                  <button className="btn-gym-secondary" onClick={() => { setProposed(null); setStatus(null) }}>Discard</button>
                  <button className="btn-gym-primary" onClick={confirmProposed}>Add All</button>
                </div>
              </div>
            )}

            <button
              className="ai-planner-go-btn"
              onClick={handlePlan}
              disabled={loading || !planInput.trim()}
            >
              {loading
                ? planMode === 'optimize' ? 'Optimizing…' : 'Planning…'
                : planMode === 'optimize' ? '✦ Optimize' : '✦ Plan'}
            </button>
          </div>
        )}

        {/* Ask mode */}
        {tab === 'ask' && (
          <div className="ai-planner-ask">
            <div className="ai-planner-messages">
              {messages.length === 0 && (
                <div className="ai-planner-empty">
                  Ask anything about your schedule.<br />
                  <span style={{ opacity: 0.6 }}>"Am I free Thursday afternoon?" · "How many gym sessions this month?"</span>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`ai-planner-msg ${msg.role}`}>
                  <div className="ai-planner-msg-bubble">
                    {msg.content || <span className="ai-planner-cursor">▌</span>}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="ai-planner-input-row">
              <textarea
                ref={askInputRef}
                className="ai-planner-ask-input"
                placeholder="Ask about your schedule…"
                value={askInput}
                onChange={e => setAskInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() }
                }}
                rows={2}
                disabled={streaming}
              />
              <button
                className="ai-planner-send-btn"
                onClick={handleAsk}
                disabled={streaming || !askInput.trim()}
              >
                ↑
              </button>
            </div>
          </div>
        )}

      </div>
    </>
  )
}
