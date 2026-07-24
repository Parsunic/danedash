import { supabase } from '../../lib/supabase.js'
import { CONTEXT_SOURCES, CONTEXT_DEFAULTS, SKINS } from './overseerConfig.js'

// Slash-command parser + handlers for the Overseer Terminal.
// runCommand(line, ctx) → { blocks: [{kind, text}], actions: {...} }
//   blocks kinds: 'sys' (dim amber, pre-wrap) · 'tbl' (pre, x-scroll) ·
//                 'err' (phosphor red, rendered "!! <text>") · 'dim' (comment line)
//   actions: configPatch · recallHits · recalled · promptEdit · clear · export
// Command output is terminal-local — NEVER sent to the API.
// overseer_messages columns (verified live): id, session_id, role, content,
// model_used, created_at.

const sys = (text) => ({ kind: 'sys', text })
const tbl = (text) => ({ kind: 'tbl', text })
const err = (text) => ({ kind: 'err', text })
const dim = (text) => ({ kind: 'dim', text })

function fmtTable(rows, gap = 3) {
  const widths = []
  rows.forEach(r => r.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, String(c).length) }))
  return rows
    .map(r => r.map((c, i) => (i === r.length - 1 ? String(c) : String(c).padEnd(widths[i] + gap))).join(''))
    .join('\n')
}

function snippet(content, query, width = 64) {
  const text = String(content || '').replace(/\s+/g, ' ').trim()
  const idx = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (idx < 0) return text.slice(0, width) + (text.length > width ? '…' : '')
  const start = Math.max(0, idx - Math.floor((width - query.length) / 2))
  const end = Math.min(text.length, start + width)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

const HELP_COMMON = [
  ['/help [all]', 'this list · all adds hidden commands'],
  ['/context [src n]', 'view or tune the context budget'],
  ['/recall <query>', 'search all past conversations'],
  ['/recall load <n>', 'reference a found exchange'],
  ['/sessions', 'recent conversation sessions'],
  ['/mode quick|standard', 'response depth + context size'],
  ['/clear', 'wipe transcript, new session'],
  ['/export', 'weekly context package'],
]

const HELP_HIDDEN = [
  ['/prompt show', 'active static prompt + context preview'],
  ['/prompt edit', 'override the static prompt (editor)'],
  ['/prompt reset', 'drop the override'],
  ['/model haiku|sonnet|auto', 'pin or auto-select the model'],
  ['/skin <name>', SKINS.join(' ')],
  ['/raw', 'exact last request payload (key redacted)'],
]

function cmdHelp(args) {
  const all = args[0] === 'all'
  const rows = all ? [...HELP_COMMON, ...HELP_HIDDEN] : HELP_COMMON
  const foot = all ? '' : '\n\n/help all reveals the hidden set.'
  return { blocks: [tbl(fmtTable(rows) + foot)] }
}

function contextTable(ctx) {
  const rows = [['source', 'setting', 'current']]
  CONTEXT_SOURCES.forEach(s => {
    rows.push([s.arg, `/context ${s.arg} <n>`, `${ctx[s.key]} ${s.unit}`])
  })
  rows.push(['habits', '/context habits on|off', ctx.habits ? 'on' : 'off'])
  return fmtTable(rows)
}

function cmdContext(args, ctx) {
  const cur = ctx.config.context
  if (!args.length) {
    return { blocks: [tbl(contextTable(cur)), sys('/context reset restores defaults.')] }
  }
  if (args[0] === 'reset') {
    const next = { ...CONTEXT_DEFAULTS }
    return {
      blocks: [sys('context budget reset to defaults.'), tbl(contextTable(next))],
      actions: { configPatch: { context: next } },
    }
  }
  if (args[0] === 'habits') {
    const v = args[1]
    if (v !== 'on' && v !== 'off') return { blocks: [err('usage: /context habits on|off')] }
    const next = { ...cur, habits: v === 'on' }
    return {
      blocks: [sys(`habits context → ${v}`)],
      actions: { configPatch: { context: next } },
    }
  }
  const src = CONTEXT_SOURCES.find(s => s.arg === args[0])
  if (!src) return { blocks: [err(`unknown context source "${args[0]}" — try /context`)] }
  const n = Math.round(Number(args[1]))
  if (!Number.isFinite(n)) return { blocks: [err(`usage: /context ${src.arg} <n>`)] }
  const clamped = Math.min(src.max, Math.max(src.min, n))
  const next = { ...cur, [src.key]: clamped }
  const note = clamped !== n ? ` (clamped to ${src.min}–${src.max})` : ''
  return {
    blocks: [sys(`${src.arg} context → ${clamped} ${src.unit}${note}`)],
    actions: { configPatch: { context: next } },
  }
}

async function cmdRecall(args, ctx) {
  if (args[0] === 'load') {
    const n = Math.round(Number(args[1]))
    const hits = ctx.recallHits || []
    if (!Number.isFinite(n) || !hits[n - 1]) {
      return { blocks: [err(hits.length ? `usage: /recall load <1–${hits.length}>` : 'no hits loaded — run /recall <query> first.')] }
    }
    const hit = hits[n - 1]
    const { data, error } = await supabase
      .from('overseer_messages')
      .select('role, content, created_at')
      .eq('session_id', hit.session_id)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) return { blocks: [err(`error: recall load failed — ${error.message}`)] }
    const rows = data || []
    const idx = rows.findIndex(r => r.created_at === hit.created_at && r.role === hit.role)
    let userRow = null, assistantRow = null
    if (idx >= 0 && rows[idx].role === 'user') {
      userRow = rows[idx]
      assistantRow = rows.slice(idx + 1).find(r => r.role === 'assistant') || null
    } else if (idx >= 0) {
      assistantRow = rows[idx]
      userRow = rows.slice(0, idx).reverse().find(r => r.role === 'user') || null
    }
    if (!userRow && !assistantRow) return { blocks: [err('error: could not reconstruct that exchange.')] }
    const date = (hit.created_at || '').slice(0, 10)
    return {
      blocks: [dim(`// recalled from ${date} — referenced in your next message.`)],
      actions: { recalled: { date, user: userRow?.content || '', assistant: assistantRow?.content || '' } },
    }
  }

  const q = args.join(' ').trim()
  if (!q) return { blocks: [err('usage: /recall <query>')] }
  const { data, error } = await supabase
    .from('overseer_messages')
    .select('session_id, role, content, created_at')
    .ilike('content', `%${q}%`)
    .order('created_at', { ascending: false })
    .limit(40)
  if (error) return { blocks: [err(`error: recall failed — ${error.message}`)] }
  const seen = new Map()
  ;(data || []).forEach(row => { if (!seen.has(row.session_id)) seen.set(row.session_id, row) })
  const hits = [...seen.values()].slice(0, 8)
  if (!hits.length) return { blocks: [sys(`no matches for "${q}".`)] }
  const rows = hits.map((h, i) => [
    ` ${i + 1}`,
    (h.created_at || '').slice(0, 10),
    h.role === 'user' ? 'you' : 'overseer',
    `"${snippet(h.content, q)}"`,
  ])
  return {
    blocks: [tbl(fmtTable(rows)), sys('/recall load <n> references that exchange.')],
    actions: { recallHits: hits },
  }
}

async function cmdSessions() {
  const { data, error } = await supabase
    .from('overseer_messages')
    .select('session_id, content, created_at')
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return { blocks: [err(`error: sessions failed — ${error.message}`)] }
  const bySession = new Map() // first-seen order = most recent activity
  ;(data || []).forEach(row => {
    if (!bySession.has(row.session_id)) bySession.set(row.session_id, [])
    bySession.get(row.session_id).push(row)
  })
  const sessions = [...bySession.values()].slice(0, 10)
  if (!sessions.length) return { blocks: [sys('no past sessions logged yet.')] }
  const rows = sessions.map((msgs, i) => {
    const opener = msgs[msgs.length - 1] // oldest fetched = session opener
    return [` ${i + 1}`, (opener.created_at || '').slice(0, 10), `"${snippet(opener.content, null, 58)}"`]
  })
  return { blocks: [tbl(fmtTable(rows)), sys('/recall <query> searches inside them.')] }
}

function truncate(text, max) {
  const t = String(text || '')
  return t.length > max ? t.slice(0, max) + `\n… (+${t.length - max} more chars)` : t
}

async function cmdPrompt(args, ctx) {
  const sub = args[0]
  if (sub === 'show') {
    const stat = await ctx.getStaticPrompt()
    const dyn = await ctx.getDynamicContext()
    const origin = ctx.config.promptOverride ? 'override active — /prompt reset to revert' : 'from settings table / fallback'
    return {
      blocks: [
        sys(`static prompt (${origin}) — ${stat.length} chars:`),
        tbl(truncate(stat, 1400)),
        sys(`dynamic context (built now) — ${dyn.length} chars:`),
        tbl(truncate(dyn, 1200)),
      ],
    }
  }
  if (sub === 'edit') {
    return { blocks: [sys('prompt editor open — ctrl+enter saves, esc cancels.')], actions: { promptEdit: true } }
  }
  if (sub === 'reset') {
    if (!ctx.config.promptOverride) return { blocks: [sys('no prompt override set.')] }
    return { blocks: [sys('prompt override cleared — back to the settings-table prompt.')], actions: { configPatch: { promptOverride: null } } }
  }
  return { blocks: [err('usage: /prompt show|edit|reset')] }
}

function cmdModel(args) {
  const m = args[0]
  if (!['haiku', 'sonnet', 'auto'].includes(m)) return { blocks: [err('usage: /model haiku|sonnet|auto')] }
  const label = m === 'auto' ? 'auto (selected per message)' : `${m} (pinned)`
  return { blocks: [sys(`model → ${label}`)], actions: { configPatch: { model: m } } }
}

function cmdMode(args) {
  const m = args[0]
  if (!['quick', 'standard'].includes(m)) return { blocks: [err('usage: /mode quick|standard')] }
  const label = m === 'quick' ? 'quick (haiku, slim context)' : 'standard (auto model, full context)'
  return { blocks: [sys(`mode → ${label}`)], actions: { configPatch: { mode: m } } }
}

function cmdSkin(args) {
  const s = args[0]
  if (!SKINS.includes(s)) return { blocks: [err(`usage: /skin ${SKINS.join('|')}`)] }
  return { blocks: [sys(`companion skin → ${s}`)], actions: { configPatch: { skin: s } } }
}

function cmdRaw(ctx) {
  if (!ctx.lastRequest) {
    return { blocks: [dim('// nothing sent yet — /raw shows the exact request payload after your first message.')] }
  }
  const req = ctx.lastRequest
  const display = {
    url: req.url,
    headers: { ...req.headers, 'x-api-key': '<redacted>' },
    body: {
      ...req.body,
      system: truncate(req.body.system, 900),
      messages: (req.body.messages || []).map(m => ({ role: m.role, content: truncate(m.content, 400) })),
    },
  }
  return {
    blocks: [
      tbl(JSON.stringify(display, null, 2)),
      sys('long strings truncated for display · api key redacted.'),
    ],
  }
}

// ctx = { config, recallHits, lastRequest, getStaticPrompt(), getDynamicContext() }
export async function runCommand(line, ctx) {
  const parts = line.slice(1).trim().split(/\s+/).filter(Boolean)
  const name = (parts[0] || '').toLowerCase()
  const args = parts.slice(1)

  switch (name) {
    case 'help':     return cmdHelp(args)
    case 'context':  return cmdContext(args, ctx)
    case 'recall':   return cmdRecall(args, ctx)
    case 'sessions': return cmdSessions()
    case 'prompt':   return cmdPrompt(args, ctx)
    case 'model':    return cmdModel(args)
    case 'mode':     return cmdMode(args)
    case 'skin':     return cmdSkin(args)
    case 'raw':      return cmdRaw(ctx)
    case 'export':   return { blocks: [], actions: { export: true } }
    case 'clear':    return { blocks: [], actions: { clear: true } }
    default:         return { blocks: [err(`unknown command — try /help`)] }
  }
}
