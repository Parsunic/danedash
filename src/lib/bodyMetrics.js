import { storeGet, storeSet } from './storage.js'
import { getActiveDateString } from './dateHelpers.js'
import { getWeightUnit } from '../modules/gym/gymUtils.js'

// B3 — Body metrics (weigh-in log). Single synced static key `body_metrics_v1`:
//   { v:1, entries: [{ date:'YYYY-MM-DD', weight:Number, unit:'lbs'|'kg', waist?:Number }] }
// Entries are sorted ascending by date, one per date (same-day re-log overwrites),
// capped at MAX_ENTRIES (newest kept). Absent key → empty in-memory default; NEVER
// written at boot. logEntry is the only writer and runs on a user gesture (storeSet).
// Display + deltas normalize every entry to the live gym_settings weight unit, so a
// history logged across a unit change still reads correctly in the current unit.

const KEY = 'body_metrics_v1'
const MAX_ENTRIES = 730
const LB_PER_KG = 2.20462

// Live weight-unit preference (gym_settings). All display/deltas normalize to this.
export function currentUnit() {
  return getWeightUnit()
}

// Convert a weight between 'lbs' and 'kg'. Equal/unknown units pass through.
export function convertWeight(value, from, to) {
  if (value == null || !Number.isFinite(Number(value))) return null
  const v = Number(value)
  if (from === to || !from || !to) return v
  if (from === 'kg' && to === 'lbs') return v * LB_PER_KG
  if (from === 'lbs' && to === 'kg') return v / LB_PER_KG
  return v
}

// Read-only. Absent/malformed key → [] (no boot write).
export function getEntries() {
  const data = storeGet(KEY)
  if (!data || !Array.isArray(data.entries)) return []
  return data.entries
}

export function getLatest() {
  const e = getEntries()
  return e.length ? e[e.length - 1] : null
}

function dateMs(ds) {
  const [y, m, d] = String(ds).split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

// USER GESTURE ONLY. date = active date; unit = live gym_settings weightUnit.
// Same-day re-log overwrites the existing entry; result stays sorted ascending
// and capped at MAX_ENTRIES. Returns the updated entries array.
export function logEntry({ weight, waist } = {}) {
  const w = Number(weight)
  if (!Number.isFinite(w) || w <= 0) return getEntries()
  const date = getActiveDateString()
  const unit = getWeightUnit()
  const entry = { date, weight: w, unit }
  const waistNum = Number(waist)
  if (waist != null && waist !== '' && Number.isFinite(waistNum) && waistNum > 0) {
    entry.waist = waistNum
  }
  const entries = getEntries().filter(e => e.date !== date)
  entries.push(entry)
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const capped = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries
  storeSet(KEY, { v: 1, entries: capped })
  return capped
}

// Entries' weights normalized to `unit` (default live unit): [{ date, weight }].
export function seriesIn(entries, unit) {
  const u = unit || getWeightUnit()
  return (entries ?? getEntries()).map(e => ({ date: e.date, weight: convertWeight(e.weight, e.unit, u) }))
}

// Δ vs the nearest entry ~7d and ~30d before the latest, normalized to `unit`
// (default live unit). Negative = lost weight since then. null when there is no
// prior entry to compare against.
export function deltas(entries, unit) {
  const list = entries ?? getEntries()
  const u = unit || getWeightUnit()
  if (list.length < 2) return { d7: null, d30: null, unit: u }
  const latest = list[list.length - 1]
  const latestW = convertWeight(latest.weight, latest.unit, u)
  const latestT = dateMs(latest.date)
  const older = list.slice(0, -1)
  const pick = (daysAgo) => {
    const target = latestT - daysAgo * 86400000
    let best = null, bestDist = Infinity
    for (const e of older) {
      const dist = Math.abs(dateMs(e.date) - target)
      if (dist < bestDist) { bestDist = dist; best = e }
    }
    if (!best) return null
    return latestW - convertWeight(best.weight, best.unit, u)
  }
  return { d7: pick(7), d30: pick(30), unit: u }
}
