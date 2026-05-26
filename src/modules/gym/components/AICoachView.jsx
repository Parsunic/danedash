import { useState, useCallback } from 'react'
import { storeGet, storeSet } from '../../../lib/storage.js'
import { gymUUID, DSHORT, dateToStr } from '../gymUtils.js'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export default function AICoachView({ onPlanLoaded }) {
  const [goal, setGoal] = useState('muscle gain')
  const [daysPerWeek, setDaysPerWeek] = useState('4')
  const [weeksAhead, setWeeksAhead] = useState('2')
  const [notes, setNotes] = useState('')
  const [selectedDays, setSelectedDays] = useState(new Set())
  const [generating, setGenerating] = useState(false)
  const [aiStatus, setAiStatus] = useState({ msg: '', cls: '' })

  const toggleDay = useCallback(i => {
    setSelectedDays(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }, [])

  const generate = useCallback(async () => {
    const apiKey = localStorage.getItem('anthropic_api_key') || ''
    if (!apiKey) {
      setAiStatus({ msg: 'API key not set — open Settings (⚙) and add your Anthropic key.', cls: 'error' })
      return
    }
    const prefDays = selectedDays.size > 0
      ? [...selectedDays].sort().map(i => DSHORT[i]).join(', ')
      : 'Any days'
    const weeks = parseInt(weeksAhead)
    const prompt =
      `You are an expert strength and conditioning coach. Generate a ${weeks}-week progressive workout program.\n\n` +
      `User details:\n- Goal: ${goal}\n- Training days/week: ${daysPerWeek}\n- Preferred days: ${prefDays}\n- Notes: ${notes || 'none'}\n\n` +
      `Return ONLY raw JSON — no markdown fences, no explanations:\n` +
      `{"weeks":[{"week":1,"workouts":[{"day":"Mon","name":"Push Day A","exercises":[{"name":"Barbell Bench Press","sets":4,"rep_range":"6-8","intensity":"RPE 8","notes":""}]}]}]}\n\n` +
      `Rules:\n` +
      `- NEVER use absolute weights — only RPE (e.g. "RPE 7-8") or % of 1RM (e.g. "75% 1RM")\n` +
      `- Progressive overload each week (increase sets, reps, or intensity)\n` +
      `- 3-6 exercises per session, 1-2 warm-up notes if helpful\n` +
      `- Use only days from the preferred list if specified\n` +
      `- rep_range must be a string like "6-8" or "10-12"`

    setGenerating(true)
    setAiStatus({ msg: 'Calling Progressive Overload Coach…', cls: '' })
    try {
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
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await resp.json()
      if (data.error) throw new Error(data.error.message)
      let text = data.content[0].text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      const plan = JSON.parse(text)
      const weekOffset = populatePlanner(plan, weeks)
      setAiStatus({ msg: `✓ ${weeks}-week plan loaded into Planner — navigate there to review.`, cls: 'success' })
      onPlanLoaded(weekOffset)
    } catch (e) {
      console.error('AI coach:', e)
      setAiStatus({ msg: 'Generation failed: ' + (e.message || 'unknown error'), cls: 'error' })
    } finally {
      setGenerating(false)
    }
  }, [goal, daysPerWeek, weeksAhead, notes, selectedDays, onPlanLoaded])

  return (
    <div className="ai-coach-card">
      <div className="ai-coach-title">Progressive Overload Coach</div>
      <div className="ai-coach-sub">Tell the AI your goals and schedule — it'll generate a structured weekly plan with exercises, sets, rep ranges, and RPE targets. The plan loads directly into your Planner.</div>
      <div className="ai-coach-form">
        <div className="gym-field">
          <label>Primary Goal</label>
          <select className="gym-input" value={goal} onChange={e => setGoal(e.target.value)}>
            <option value="muscle gain">Muscle Gain (Hypertrophy)</option>
            <option value="strength">Strength (1RM Focus)</option>
            <option value="fat loss">Fat Loss &amp; Conditioning</option>
            <option value="general fitness">General Fitness</option>
            <option value="athletic performance">Athletic Performance</option>
          </select>
        </div>
        <div className="gym-field">
          <label>Days Per Week Available</label>
          <select className="gym-input" value={daysPerWeek} onChange={e => setDaysPerWeek(e.target.value)}>
            {['2','3','4','5','6'].map(n => <option key={n} value={n}>{n} days</option>)}
          </select>
        </div>
        <div className="gym-field">
          <label>Preferred Training Days</label>
          <div className="ai-days-picker">
            {DSHORT.map((name, i) => (
              <button
                key={i}
                className={`ai-day-toggle${selectedDays.has(i) ? ' active' : ''}`}
                onClick={() => toggleDay(i)}
              >{name}</button>
            ))}
          </div>
        </div>
        <div className="gym-field">
          <label>Weeks to Plan Ahead</label>
          <select className="gym-input" value={weeksAhead} onChange={e => setWeeksAhead(e.target.value)}>
            <option value="1">1 week</option>
            <option value="2">2 weeks</option>
            <option value="4">4 weeks</option>
          </select>
        </div>
        <div className="gym-field">
          <label>Additional Notes (optional)</label>
          <input type="text" className="gym-input" placeholder="e.g. no barbell, focus on upper body…" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <button className="ai-generate-btn" disabled={generating} onClick={generate}>
          {generating ? 'Generating…' : 'Generate My Plan'}
        </button>
        <div className={`ai-status${aiStatus.cls ? ' ' + aiStatus.cls : ''}`}>{aiStatus.msg}</div>
      </div>
    </div>
  )
}

function populatePlanner(plan, weeksAhead) {
  if (!plan || !Array.isArray(plan.weeks)) return 0
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const planned = storeGet('gym_planned') || []
  const now = new Date()
  const dow = now.getDay()
  const toMon = dow === 0 ? 1 : (8 - dow) % 7 || 7
  const nextMon = new Date(now)
  nextMon.setDate(now.getDate() + toMon)
  nextMon.setHours(0, 0, 0, 0)

  plan.weeks.forEach((week, wi) => {
    ;(week.workouts || []).forEach(wo => {
      const di = dayMap[wo.day]
      if (di === undefined) return
      const offsetFromMon = (di - 1 + 7) % 7
      const date = new Date(nextMon)
      date.setDate(nextMon.getDate() + wi * 7 + offsetFromMon)
      const ds = dateToStr(date)
      const exercises = (wo.exercises || []).map(ex => ({
        name: ex.name || '',
        sets: ex.sets || 3,
        repRange: ex.rep_range || '8–10',
        notes: [ex.intensity, ex.notes].filter(Boolean).join(' — '),
      }))
      const idx = planned.findIndex(p => p.date === ds)
      if (idx >= 0) planned.splice(idx, 1)
      planned.push({ id: gymUUID(), date: ds, name: wo.name || 'Workout', templateId: null, exercises, status: 'upcoming' })
    })
  })
  storeSet('gym_planned', planned)

  const thisSun = new Date(now); thisSun.setDate(now.getDate() - dow); thisSun.setHours(0, 0, 0, 0)
  const diffDays = Math.round((nextMon - thisSun) / 86400000)
  return Math.floor(diffDays / 7)
}
