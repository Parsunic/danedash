import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { storeGet } from '../../lib/storage.js'
import { getActiveDateString, getActiveWeekKey } from '../../lib/dateHelpers.js'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const PULSE_MODEL = 'claude-sonnet-4-6'

const DOMAIN_COLORS = {
  fitness:   '#E8A020',
  sleep:     '#7048E8',
  mental:    '#6BE3A4',
  learning:  '#1971C2',
  academics: '#F2C063',
  other:     'rgba(255,255,255,0.4)',
}

function domainColor(domain) {
  return DOMAIN_COLORS[domain] ?? 'rgba(255,255,255,0.4)'
}

function formatDueDate(dueDateStr) {
  const today = getActiveDateString()
  const [ty, tm, td] = today.split('-').map(Number)
  const [dy, dm, dd] = dueDateStr.split('-').map(Number)
  const diffDays = Math.round((new Date(dy, dm - 1, dd) - new Date(ty, tm - 1, td)) / 86400000)
  if (diffDays === 0) return { label: 'Due today', urgent: true }
  if (diffDays === 1) return { label: 'Due tomorrow', urgent: true }
  if (diffDays > 0 && diffDays <= 3) return { label: `Due in ${diffDays} days`, urgent: true }
  if (diffDays < 0) return { label: `Overdue ${-diffDays}d`, urgent: true }
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return { label: `Due ${MONTHS[dm - 1]} ${dd}`, urgent: false }
}

function loadHabitData() {
  const today = getActiveDateString()
  const habits = storeGet('habits') || []
  const log = storeGet('habits_log:' + getActiveWeekKey()) || {}
  const gymDates = new Set((storeGet('gym_workout_logs') || []).map(l => l.date))
  const completed = habits.filter(h =>
    h.auto_source === 'gym' ? gymDates.has(today) : (log[h.id] || []).includes(today)
  )
  return { habits, completed }
}

function loadNextMilestone() {
  const goals = storeGet('goals_projects') || []
  const active = goals.filter(g => g.milestones?.some(m => !m.done))
  const withDue = active
    .flatMap(g => (g.milestones || []).filter(m => !m.done && m.due_date).map(m => ({ goal: g, milestone: m })))
    .sort((a, b) => a.milestone.due_date.localeCompare(b.milestone.due_date))
  if (withDue.length > 0) return withDue[0]
  for (const g of active) {
    const m = g.milestones?.find(m => !m.done)
    if (m) return { goal: g, milestone: m }
  }
  return null
}

export default function GoalsPulseCard() {
  const [habitData, setHabitData] = useState(loadHabitData)
  const [nextMs, setNextMs] = useState(loadNextMilestone)
  const [verdict, setVerdict] = useState(null)
  const [loadingVerdict, setLoadingVerdict] = useState(false)

  const refresh = useCallback(() => {
    setHabitData(loadHabitData())
    setNextMs(loadNextMilestone())
  }, [])

  useEffect(() => {
    window.addEventListener('goals-changed', refresh)
    window.addEventListener('gym-changed', refresh)
    return () => {
      window.removeEventListener('goals-changed', refresh)
      window.removeEventListener('gym-changed', refresh)
    }
  }, [refresh])

  useEffect(() => {
    const today = getActiveDateString()
    const cacheKey = 'goals_pulse_verdict:' + today
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey))
      if (cached?.verdict) { setVerdict(cached.verdict); return }
    } catch {}

    const apiKey = localStorage.getItem('anthropic_api_key') || ''
    if (!apiKey) return

    setLoadingVerdict(true)
    const { habits, completed } = loadHabitData()
    const allGoals = storeGet('goals_projects') || []
    const activeGoals = allGoals.filter(g => g.milestones?.some(m => !m.done))
    const ms = loadNextMilestone()
    const doneDomains = completed.map(h => h.domain)
    const msInfo = ms
      ? `${ms.goal.title} — ${ms.milestone.text}${ms.milestone.due_date ? ` (due ${ms.milestone.due_date})` : ''}`
      : 'none'

    const prompt = `You are an assistant for a personal life management app. Here is today's data for the user: Habits completed today: ${completed.length} of ${habits.length}${doneDomains.length ? `, domains done: ${doneDomains.join(', ')}` : ''}. Next upcoming milestone: ${msInfo}. Active goals: ${activeGoals.length}. Respond with a single sentence (max 15 words) of honest, warm, priority-aware assessment of how today is going. Do not start with 'I'. Do not use the word 'you' more than once. Examples of good verdicts: 'Gym done and essay submitted — the important things landed today.' or 'Sleep and gym protected — the rest can wait.' or 'Two habits down, key milestone pending — good trajectory.'`

    fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: PULSE_MODEL,
        max_tokens: 80,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const text = data?.content?.[0]?.text?.trim()
        if (!text) return
        localStorage.setItem(cacheKey, JSON.stringify({ verdict: text, generated_at: new Date().toISOString() }))
        setVerdict(text)
      })
      .catch(() => {})
      .finally(() => setLoadingVerdict(false))
  }, [])

  const { habits, completed } = habitData
  const dueInfo = nextMs?.milestone?.due_date ? formatDueDate(nextMs.milestone.due_date) : null

  return (
    <div className="dash-widget dash-pulse-card card-interactive">
      <div className="dash-pulse-label">Today's Pulse</div>

      <div className="pulse-habits-row">
        <div className="pulse-dots">
          {habits.map(h => {
            const done = completed.some(c => c.id === h.id)
            return (
              <div
                key={h.id}
                className="pulse-dot"
                style={done ? { background: domainColor(h.domain), border: 'none' } : {}}
                title={h.name}
              />
            )
          })}
          {habits.length === 0 && <span className="pulse-no-habits">No habits set</span>}
        </div>
        {habits.length > 0 && (
          <span className="pulse-habit-count">{completed.length} / {habits.length} habits</span>
        )}
      </div>

      <div className="pulse-milestone">
        {nextMs ? (
          <>
            <div className="pulse-milestone-goal">{nextMs.goal.title}</div>
            <div className="pulse-milestone-text">{nextMs.milestone.text}</div>
            {dueInfo && (
              <div className="pulse-milestone-due" data-urgent={dueInfo.urgent ? 'true' : 'false'}>
                {dueInfo.label}
              </div>
            )}
          </>
        ) : (
          <div className="pulse-no-goals">No active goals — add one in Goals</div>
        )}
      </div>

      {(verdict || loadingVerdict) && (
        <div className="pulse-verdict">
          <span className="pulse-verdict-star">✦</span>
          <span className={`pulse-verdict-text${loadingVerdict ? ' is-loading' : ''}`}>
            {loadingVerdict ? 'Assessing your day…' : verdict}
          </span>
        </div>
      )}

      <div className="pulse-footer">
        <Link to="/goals" className="pulse-footer-link">View Goals →</Link>
      </div>
    </div>
  )
}
