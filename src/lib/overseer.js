import { supabase } from './supabase.js'
import { storeGet } from './storage.js'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export const STATIC_PROMPT_FALLBACK = `You are Overseer — the AI advisor embedded in Parsa's personal OS (DaneDash). You make concrete decisions. When asked to choose between options, pick one and defend it. Never hedge.

## Profile
Name: Parsa | Grade: Junior (apps due Nov 2025, ~5 months) | Potomac, MD
Citizenship: Canadian — international at US schools, domestic at Canadian schools

## College targets
Path A: MIT, Princeton, Harvard, Yale (need-blind international — meet full demonstrated need)
Path B: Tulsa (full-ride merit), Davidson, McGill, Waterloo CS (near-free as Canadian)

## Academic
SAT: 1550 (750R/800M), 2nd attempt pending June 20 (expect ~760-790R / slightly below 800M)
Canada GPA: 97-100 across all Pre-IB courses, Halifax West HS, Nova Scotia
US GPA: All A's, Churchill HS, Potomac MD — AP BC Calculus, AP French, AP Macro, Honors Physics/Chem/English/History (mid-year transfer, was blocked from most APs by policy; caught up to BC Calc from Pre-IB Math independently)
Weighted GPA: 5.0 / 4.67 on paper (transfer credit handling artifact)
Grade 12: Multivariable Calculus, Differential Equations, Linear Algebra, Discrete Math, AP Physics C, AP Lit, AP Micro, AP CS Java, AP Gov, TA AP Macro

## Extracurriculars (by application impact)
1. Immersa Axiom Robotics — VP Strategy & Design; FIRA World Championships
2. Varsity + club volleyball
3. DaneDash — full-stack personal OS (React/Vite/Supabase/Vercel), AI-powered, production-deployed; building this Overseer system now
4. AMC 12 — targeting AIME qualification
5. Immersa VR — father's VR business (events, birthday parties)

## Narrative
"Builder who ships real products. A problem solver who DOES." DaneDash (deployed, AI-integrated) and robotics (World Championships) are the proof. Applying CS + Economics or Applied Math framing. Honest weaknesses: DaneDash is heavily vibe-coded; volleyball is not elite-level; transfer GPA optics are slightly messy.

## Decision rules
- Pick one option and defend it. No hedging.
- Optimize decisions for MIT and Princeton specifically.
- Canadian schools are near-free — always factor into opportunity cost.
- Flag when something risks diluting the core "builder" narrative.
- Be direct about weaknesses, not just strengths.

## Dynamic context
Live DaneDash data is appended below this line each session.`

export function selectModel(message, mode) {
  if (mode === 'quick') return 'claude-haiku-4-5-20251001'
  const strategic = /strateg|essay|applicat|rank|decide|compar|analyz|which school|priorit|college|admiss|SAT|narrative|activity|extracurr/i
  if (strategic.test(message) || message.length > 180) return 'claude-sonnet-4-6'
  return 'claude-haiku-4-5-20251001'
}

export function maxTokensForModel(model) {
  return model.includes('haiku') ? 1024 : 2048
}

export async function fetchStaticPrompt() {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'overseer_static_prompt')
      .maybeSingle()
    if (!error && data?.value) return data.value
  } catch {}
  return null
}

function getLocalGoalsContext() {
  const today = new Date()
  const lines = []
  for (let i = 0; i < 3; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = `goals:${d.toISOString().slice(0, 10)}`
    const goals = storeGet(key) || []
    if (goals.length) {
      const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d.toISOString().slice(0, 10)
      lines.push(`${label}:\n` + goals.map(g => `${g.done ? '✓' : '○'} ${g.text}`).join('\n'))
    }
  }
  return lines.join('\n\n')
}

export async function buildDynamicContext(mode) {
  const lines = ['\n\n## Live DaneDash context (injected now)']

  const goalsCtx = getLocalGoalsContext()
  if (goalsCtx) lines.push('\n### Tasks\n' + goalsCtx)

  try {
    const { data, error } = await supabase.from('habits').select('name, streak, completed_today')
    if (!error && data?.length) {
      lines.push('\n### Habits\n' + data.map(h =>
        `${h.name}: ${h.streak ?? 0} day streak${h.completed_today ? ' ✓' : ''}`
      ).join('\n'))
    }
  } catch {}

  if (mode === 'quick') return lines.join('')

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  try {
    const localJournal = JSON.parse(localStorage.getItem('journal_entries') || '[]')
    const recent = localJournal
      .filter(e => (e.created_at || '') >= sevenDaysAgo)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
    if (recent.length) {
      lines.push('\n### Recent journal\n' + recent.map(e => {
        const text = e.content || e.text || ''
        return `[${(e.created_at || '').slice(0, 10)}] ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`
      }).join('\n'))
    }
  } catch {}

  try {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('content, created_at')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(3)
    if (!error && data?.length) {
      lines.push('\n### Supabase journal\n' + data.map(e =>
        `[${(e.created_at || '').slice(0, 10)}] ${(e.content || '').slice(0, 200)}`
      ).join('\n'))
    }
  } catch {}

  return lines.join('')
}

export async function callOverseer({ apiKey, systemPrompt, messages, model, onChunk, onDone, historyWindow = 8 }) {
  const recent = messages.slice(-historyWindow)
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokensForModel(model),
      stream: true,
      system: systemPrompt,
      messages: recent,
    }),
  })

  if (!res.ok) throw new Error(`API error: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

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
          fullText += ev.delta.text
          onChunk(ev.delta.text)
        }
      } catch {}
    }
  }

  onDone(fullText)
  return fullText
}

export async function generateContextPackage(apiKey, dynamicContext) {
  const res = await fetch(ANTHROPIC_URL, {
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
      system: `You are Overseer. Generate a structured weekly context package for Parsa, formatted to paste into a Claude Project. Include: current priorities and active goals, task completion status, recent journal themes, key pending decisions, momentum indicators, and a one-line situational assessment. Use markdown headers. Be specific and concrete — this is a briefing, not a summary.`,
      messages: [{
        role: 'user',
        content: `Here is my current DaneDash data:\n${dynamicContext}\n\nGenerate my weekly context package.`,
      }],
    }),
  })

  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.content[0].text.trim()
}

export async function saveMessage({ sessionId, role, content, modelUsed }) {
  try {
    await supabase.from('overseer_messages').insert({
      session_id: sessionId,
      role,
      content,
      model_used: modelUsed || null,
    })
  } catch {}
}
