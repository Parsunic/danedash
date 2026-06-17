import { useState, useEffect, useCallback, useRef } from 'react'
import { storeGet, storeSet } from '../../../lib/storage.js'
import { getActiveDateString, getActiveWeekKey } from '../../../lib/dateHelpers.js'
import { getAnthropicKey } from '../../../lib/api/anthropic.js'

// ── Date helpers (self-contained; mirrors dateHelpers.js logic for arbitrary dates) ──

function localDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getWeekKeyForDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const day = date.getDay() || 7
  const thursday = new Date(y, m - 1, d + (4 - day))
  const jan1 = new Date(thursday.getFullYear(), 0, 1)
  const week = Math.ceil(((thursday - jan1) / 86400000 + 1) / 7)
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`
}

function getMondayOfWeekKey(weekKey) {
  const [yearStr, weekStr] = weekKey.split('-W')
  const year = parseInt(yearStr)
  const week = parseInt(weekStr)
  const jan4 = new Date(year, 0, 4)
  const dayOfJan4 = jan4.getDay() || 7
  const monday = new Date(year, 0, 4 - (dayOfJan4 - 1) + (week - 1) * 7)
  return localDateStr(monday)
}

function getWeekDaysForDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay() || 7
  const days = []
  for (let i = 0; i < 7; i++) {
    days.push(localDateStr(new Date(y, m - 1, d - (dow - 1) + i)))
  }
  return days
}

// ── Context assembly ──

function assembleDailyContext() {
  const activeDate = getActiveDateString()
  const weekKey = getActiveWeekKey()
  const weekDays = getWeekDaysForDate(activeDate)

  const habits = storeGet('habits') || []
  const habitsLog = storeGet(`habits_log:${weekKey}`) || {}
  const gymLogs = storeGet('gym_workout_logs') || []
  const gymDates = new Set(gymLogs.map(l => l.date))
  const weekDaySet = new Set(weekDays)

  const dow = new Date(activeDate).getDay() || 7 // Mon=1, Sun=7
  const elapsedDays = weekDays.slice(0, dow) // Mon through today

  const todayHabits = habits.map(h => {
    const done = h.auto_source === 'gym'
      ? gymDates.has(activeDate)
      : (habitsLog[h.id] || []).includes(activeDate)
    return { name: h.name, domain: h.domain, done }
  })

  const habitWeekRates = habits.map(h => {
    const completed = elapsedDays.filter(day =>
      h.auto_source === 'gym' ? gymDates.has(day) : (habitsLog[h.id] || []).includes(day)
    ).length
    return { name: h.name, completed, elapsed: elapsedDays.length }
  })

  const goalsProjects = storeGet('goals_projects') || []
  const activeGoalsCount = goalsProjects.filter(g =>
    g.milestones.length === 0 || g.milestones.some(m => !m.done)
  ).length
  const milestonesThisWeek = goalsProjects.flatMap(g =>
    g.milestones.filter(m => m.done && m.pushed_to_date && weekDaySet.has(m.pushed_to_date))
  ).length
  const overdueItems = goalsProjects.flatMap(g =>
    g.milestones
      .filter(m => !m.done && m.due_date && m.due_date <= activeDate)
      .map(m => `"${m.text}" from "${g.title}" (due ${m.due_date})`)
  )

  const tasks = storeGet(`goals:${activeDate}`) || []
  const doneTasks = tasks.filter(t => t.done).length

  const weekGymLogs = gymLogs.filter(l => weekDaySet.has(l.date))

  const sleepData = storeGet('gfit_sleep')
  const recentSleep = Array.isArray(sleepData) && sleepData.length > 0
    ? sleepData[sleepData.length - 1]
    : (sleepData && typeof sleepData === 'object' && !Array.isArray(sleepData) ? sleepData : null)

  let ctx = `Date: ${activeDate}\n\n`

  ctx += `HABITS TODAY:\n`
  if (habits.length === 0) {
    ctx += `No habits tracked yet.\n`
  } else {
    todayHabits.forEach(h => {
      ctx += `  ${h.done ? '✓' : '✗'} ${h.name} (${h.domain})\n`
    })
    ctx += `\nHABIT COMPLETION THIS WEEK (${elapsedDays.length} days elapsed):\n`
    habitWeekRates.forEach(h => {
      ctx += `  ${h.name}: ${h.completed}/${h.elapsed} days\n`
    })
  }

  ctx += `\nGOALS & PROJECTS:\n`
  ctx += `  Active goals: ${activeGoalsCount}\n`
  ctx += `  Milestones completed this week: ${milestonesThisWeek}\n`
  if (overdueItems.length > 0) {
    ctx += `  Overdue or due today:\n`
    overdueItems.forEach(o => { ctx += `    - ${o}\n` })
  }

  ctx += `\nTASKS TODAY: ${doneTasks}/${tasks.length} done\n`
  tasks.forEach(t => { ctx += `  ${t.done ? '[x]' : '[ ]'} ${t.text}\n` })

  ctx += `\nGYM THIS WEEK: ${weekGymLogs.length} sessions\n`
  weekGymLogs.forEach(l => {
    const exs = (l.exercises || []).map(e => e.name).join(', ')
    ctx += `  ${l.date}: ${exs || 'session logged'}\n`
  })

  if (recentSleep) {
    ctx += `\nMOST RECENT SLEEP:\n`
    if (recentSleep.date) ctx += `  Date: ${recentSleep.date}\n`
    if (recentSleep.sleep_score != null) ctx += `  Score: ${recentSleep.sleep_score}\n`
    if (recentSleep.sleep_stages) ctx += `  Stages (min): ${JSON.stringify(recentSleep.sleep_stages)}\n`
    if (recentSleep.hrv != null) ctx += `  HRV: ${recentSleep.hrv}\n`
  }

  return ctx
}

const WEEK_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function assembleWeeklyContext() {
  const currentWeekKey = getActiveWeekKey()
  const currentMondayStr = getMondayOfWeekKey(currentWeekKey)
  const [cy, cm, cd] = currentMondayStr.split('-').map(Number)

  const habits = storeGet('habits') || []
  const gymLogs = storeGet('gym_workout_logs') || []
  const gymDates = new Set(gymLogs.map(l => l.date))

  const weeks = []
  for (let i = 0; i < 4; i++) {
    const monday = new Date(cy, cm - 1, cd - i * 7)
    const mondayStr = localDateStr(monday)
    const wk = getWeekKeyForDate(mondayStr)
    const weekDays = getWeekDaysForDate(mondayStr)
    const log = storeGet(`habits_log:${wk}`) || {}
    const label = i === 0 ? 'Current week' : `${i} week${i > 1 ? 's' : ''} ago`
    weeks.push({ weekKey: wk, label, weekDays, log })
  }

  const goalsProjects = storeGet('goals_projects') || []
  const activeGoalsCount = goalsProjects.filter(g =>
    g.milestones.length === 0 || g.milestones.some(m => !m.done)
  ).length

  const milestonesByWeek = weeks.map(wk => {
    const s = new Set(wk.weekDays)
    return goalsProjects.flatMap(g =>
      g.milestones.filter(m => m.done && m.pushed_to_date && s.has(m.pushed_to_date))
    ).length
  })

  const sleepData = storeGet('gfit_sleep')
  const sleepEntries = Array.isArray(sleepData) ? sleepData.slice(-28) : []

  let ctx = `Week: ${currentWeekKey}\n\n`
  ctx += `HABIT & GYM DATA — 4 WEEKS:\n\n`

  weeks.forEach((wk, wi) => {
    ctx += `${wk.label.toUpperCase()} (${wk.weekKey}):\n`
    wk.weekDays.forEach((day, di) => {
      const dayName = WEEK_DAY_NAMES[di]
      const parts = habits.map(h => {
        const done = h.auto_source === 'gym' ? gymDates.has(day) : (wk.log[h.id] || []).includes(day)
        return `${h.name}=${done ? '✓' : '✗'}`
      })
      parts.push(`gym=${gymDates.has(day) ? '✓' : '✗'}`)
      ctx += `  ${dayName}: ${parts.join(' ')}\n`
    })
    ctx += `  Milestones completed: ${milestonesByWeek[wi]}\n\n`
  })

  ctx += `GOALS: ${activeGoalsCount} active\n\n`

  if (sleepEntries.length > 0) {
    ctx += `SLEEP TREND (last ${sleepEntries.length} entries):\n`
    sleepEntries.forEach(e => {
      ctx += `  ${e.date ?? '?'}: score=${e.sleep_score ?? '?'} hrv=${e.hrv ?? '?'}\n`
    })
  }

  return ctx
}

// ── Timestamp formatters ──

function formatGeneratedTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatGeneratedDate(isoStr) {
  const d = new Date(isoStr)
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

// ── System prompts ──

const DAILY_SYSTEM = `You are a personal performance coach embedded in the user's life management app. You have access to today's data. Your job is to give an honest, warm, priority-aware daily assessment in 3–5 sentences. Key principles: hitting gym and protecting sleep is worth more than completing 10 small tasks; identify what actually mattered today and name it; if something important was skipped, note it without judgment and ask one actionable question; recognize that an incomplete task list is not failure if priorities were right. Never use bullet points. Write in second person, present tense. Be direct and specific — reference actual habits and goals by name when possible.`

const WEEKLY_SYSTEM = `You are a personal performance coach. You have 4 weeks of data for this user. Identify real patterns — not just summaries. Name the specific habit or day that keeps slipping and explain why it might be happening based on the data. Celebrate genuine wins (a habit that's held for 4 consecutive weeks, a milestone completed ahead of deadline). End with one concrete, specific recommendation for next week. 4–6 sentences, no bullet points, second person, specific and direct.`

// ── API call ──

async function callAPI(apiKey, system, userContent) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  })
  if (!resp.ok) throw new Error(`status ${resp.status}`)
  const data = await resp.json()
  const text = data.content?.[0]?.text?.trim()
  if (!text) throw new Error('empty response')
  return text
}

// ── Component ──

export default function AIInsightsCard() {
  const activeDate = getActiveDateString()
  const weekKey = getActiveWeekKey()
  const dailyCacheKey = `goals_ai_daily:${activeDate}`
  const weeklyCacheKey = `goals_ai_weekly:${weekKey}`

  const [tab, setTab] = useState('today')
  const [dailyData, setDailyData] = useState(() => storeGet(dailyCacheKey) || null)
  const [weeklyData, setWeeklyData] = useState(() => storeGet(weeklyCacheKey) || null)
  const [dailyLoading, setDailyLoading] = useState(false)
  const [weeklyLoading, setWeeklyLoading] = useState(false)
  const [dailyError, setDailyError] = useState(false)
  const [weeklyError, setWeeklyError] = useState(false)
  const autoTriggered = useRef(false)

  const generateDaily = useCallback(async (force = false) => {
    if (!force && storeGet(dailyCacheKey)) return
    const apiKey = getAnthropicKey()
    if (!apiKey) return
    setDailyLoading(true)
    setDailyError(false)
    try {
      const text = await callAPI(apiKey, DAILY_SYSTEM, assembleDailyContext())
      const result = { assessment: text, generated_at: new Date().toISOString() }
      storeSet(dailyCacheKey, result)
      setDailyData(result)
    } catch {
      setDailyError(true)
    } finally {
      setDailyLoading(false)
    }
  }, [dailyCacheKey])

  const generateWeekly = useCallback(async (force = false) => {
    if (!force && storeGet(weeklyCacheKey)) return
    const apiKey = getAnthropicKey()
    if (!apiKey) return
    setWeeklyLoading(true)
    setWeeklyError(false)
    try {
      const text = await callAPI(apiKey, WEEKLY_SYSTEM, assembleWeeklyContext())
      const result = { summary: text, generated_at: new Date().toISOString() }
      storeSet(weeklyCacheKey, result)
      setWeeklyData(result)
    } catch {
      setWeeklyError(true)
    } finally {
      setWeeklyLoading(false)
    }
  }, [weeklyCacheKey])

  useEffect(() => {
    if (autoTriggered.current) return
    if (!getAnthropicKey()) return
    if (storeGet(dailyCacheKey)) return
    if (new Date().getHours() >= 20) {
      autoTriggered.current = true
      generateDaily()
    }
  }, [dailyCacheKey, generateDaily])

  const apiKey = getAnthropicKey()

  function renderContent(isToday) {
    const loading = isToday ? dailyLoading : weeklyLoading
    const error = isToday ? dailyError : weeklyError
    const data = isToday ? dailyData : weeklyData
    const textField = isToday ? 'assessment' : 'summary'
    const loadingMsg = isToday ? 'Analyzing your day…' : 'Analyzing your week…'
    const onGenerate = isToday ? generateDaily : generateWeekly
    const formatStamp = isToday ? formatGeneratedTime : formatGeneratedDate

    if (!apiKey) {
      return (
        <div className="ai-insights-no-key">
          Add your Anthropic API key in Settings to enable AI insights.
        </div>
      )
    }
    if (loading) {
      return <div className="ai-insights-loading">{loadingMsg}</div>
    }
    if (error) {
      return (
        <div className="ai-insights-error">
          Could not generate insights —{' '}
          <button className="ai-insights-retry-btn" onClick={() => onGenerate(true)}>
            tap to retry
          </button>
          .
        </div>
      )
    }
    if (data) {
      return (
        <div className="ai-insights-content">
          <p className="ai-insights-text">{data[textField]}</p>
          <div className="ai-insights-footer">
            <span className="ai-insights-stamp">Generated {formatStamp(data.generated_at)}</span>
            <button
              className="ai-insights-regen-btn"
              onClick={() => onGenerate(true)}
            >
              Regenerate
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="ai-insights-empty">
        <button className="ai-insights-generate-btn" onClick={() => onGenerate()}>
          Generate
        </button>
      </div>
    )
  }

  return (
    <div className="ai-insights-card">
      <div className="ai-insights-header">
        <div className="ai-insights-tabs">
          <button
            className={`ai-insights-tab${tab === 'today' ? ' ai-insights-tab--active' : ''}`}
            onClick={() => setTab('today')}
          >
            Today
          </button>
          <button
            className={`ai-insights-tab${tab === 'week' ? ' ai-insights-tab--active' : ''}`}
            onClick={() => setTab('week')}
          >
            This Week
          </button>
        </div>
      </div>
      <div className="ai-insights-body">
        {renderContent(tab === 'today')}
      </div>
    </div>
  )
}
