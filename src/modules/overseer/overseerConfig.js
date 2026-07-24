import { storeGet, storeSet } from '../../lib/storage.js'

// Overseer Terminal config — synced static key `overseer_config_v1`.
// Absent key → in-memory defaults (NEVER written at boot). saveOverseerConfig is
// the ONLY writer and runs exclusively on command gestures (/context, /skin, …).

export const OVERSEER_CONFIG_KEY = 'overseer_config_v1'

export const SKINS = ['blip', 'specter', 'mochi', 'stax', 'sprout']

export const CONTEXT_DEFAULTS = {
  gymDays: 7,
  journalEntries: 3,
  goalsDays: 2,
  healthDays: 7,
  calendarDays: 3,
  habits: true,
  messages: 8,
}

// arg = the /context sub-command token · unit for display · clamp range
export const CONTEXT_SOURCES = [
  { key: 'gymDays',        arg: 'gym',      unit: 'days',    min: 0, max: 60 },
  { key: 'journalEntries', arg: 'journal',  unit: 'entries', min: 0, max: 20 },
  { key: 'goalsDays',      arg: 'goals',    unit: 'days',    min: 0, max: 14 },
  { key: 'healthDays',     arg: 'health',   unit: 'days',    min: 0, max: 60 },
  { key: 'calendarDays',   arg: 'calendar', unit: 'days',    min: 0, max: 30 },
  { key: 'messages',       arg: 'messages', unit: 'msgs',    min: 2, max: 40 },
]

export const DEFAULT_OVERSEER_CONFIG = {
  v: 1,
  context: { ...CONTEXT_DEFAULTS },
  promptOverride: null,
  model: 'auto',       // 'haiku' | 'sonnet' | 'auto'
  mode: 'standard',    // 'quick' | 'standard'
  skin: 'blip',
}

function clampNum(v, def, min, max) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

// Tolerant: unknown fields dropped, bad values → defaults. Pure — never writes.
export function sanitizeConfig(raw) {
  const d = DEFAULT_OVERSEER_CONFIG
  const src = raw && typeof raw === 'object' ? raw : {}
  const ctx = src.context && typeof src.context === 'object' ? src.context : {}
  const out = { v: 1, context: {}, promptOverride: null, model: d.model, mode: d.mode, skin: d.skin }
  CONTEXT_SOURCES.forEach(s => {
    out.context[s.key] = clampNum(ctx[s.key], CONTEXT_DEFAULTS[s.key], s.min, s.max)
  })
  out.context.habits = typeof ctx.habits === 'boolean' ? ctx.habits : CONTEXT_DEFAULTS.habits
  if (typeof src.promptOverride === 'string' && src.promptOverride.trim()) out.promptOverride = src.promptOverride
  if (['haiku', 'sonnet', 'auto'].includes(src.model)) out.model = src.model
  if (['quick', 'standard'].includes(src.mode)) out.mode = src.mode
  if (SKINS.includes(src.skin)) out.skin = src.skin
  return out
}

// Read-only load. Absent/malformed → full defaults, NO write.
export function loadOverseerConfig() {
  return sanitizeConfig(storeGet(OVERSEER_CONFIG_KEY))
}

// USER-GESTURE-ONLY writer (one storeSet per command).
export function saveOverseerConfig(cfg) {
  storeSet(OVERSEER_CONFIG_KEY, sanitizeConfig(cfg))
}
