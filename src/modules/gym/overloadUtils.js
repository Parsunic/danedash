// ─────────────────────────────────────────────────────────────────────────────
// PROGRESSIVE OVERLOAD COACH (F3)
//
// Pure, side-effect-free helpers that turn a `gym_exercise_history` entry
//   { allTimePR, sessions: [{ date, weight, reps, rpe, e1rm, allHitTop }] }
// into an explainable next-session target and a one-line trend assessment.
// No storage reads, no globals — callers pass everything in.
//
// RULE TABLE (evaluated top to bottom):
//   1. INCREASE — most recent session hit the top of the rep range on every
//      set (`allHitTop`) AND its average RPE ≤ 8.5 (missing RPE counts as ok):
//        · lower-body compound (squat / deadlift / leg press / lunge / RDL):
//            +10 lb  (or +5 kg)
//        · everything else: +5 lb (or +2.5 kg)
//      Reps reset to the BOTTOM of the exercise's rep range.
//   2. DELOAD — last 3 sessions' e1RM is flat or declining (≤ 0.5% total
//      change) AND their average RPE ≥ 9 → drop 10% (rounded to a loadable
//      plate: 5 lb / 2.5 kg), reps at the top of the range.
//      Reason: "Fatigue signal — back off to rebuild."
//   3. HOLD — otherwise: same weight, rep target at the TOP of the range
//      ("Own X×Y first.").
//   null — fewer than 2 sessions of history, or no usable working weight
//      (callers must render nothing in that case).
// ─────────────────────────────────────────────────────────────────────────────

import { parseRepRange } from './gymUtils.js'

// Lower-body compound patterns progress in bigger jumps.
const LOWER_COMPOUND_RE = /squat|deadlift|leg\s*press|lunge|\brdl\b/i

/** Weight increment per the rule table, respecting the unit. */
function incrementFor(exerciseName, unit) {
  const lower = LOWER_COMPOUND_RE.test(exerciseName || '')
  return unit === 'kg' ? (lower ? 5 : 2.5) : (lower ? 10 : 5)
}

/** Round to a loadable plate value: nearest 5 lb or 2.5 kg (never below one step). */
function roundToPlate(w, unit) {
  const step = unit === 'kg' ? 2.5 : 5
  return Math.max(step, Math.round(w / step) * step)
}

/** Trim float artifacts without forcing plate math (keeps 27.5 + 5 = 32.5 intact). */
function round1(w) {
  return Math.round(w * 10) / 10
}

/** Average RPE across entries; null when no entry carries an RPE. */
function avgRpe(entries) {
  const vals = (entries || []).map(e => +e.rpe).filter(r => r > 0)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/**
 * Suggest the next-session target for an exercise.
 *
 * @param {string} exerciseName - display name (drives the compound name-match)
 * @param {object} historyEntry - `gym_exercise_history[name]` (may be undefined)
 * @param {object} opts
 * @param {string} opts.weightUnit - 'lbs' | 'kg' (anything not 'kg' → lbs)
 * @param {string} opts.repRange   - template rep range, e.g. '8-10' (parseRepRange fallback: 8–10)
 * @returns {{ weight:number, reps:number, kind:'increase'|'hold'|'deload', reason:string, display:string } | null}
 */
export function suggestNextTarget(exerciseName, historyEntry, { weightUnit, repRange } = {}) {
  const sessions = historyEntry?.sessions || []
  if (sessions.length < 2) return null // not enough signal — render nothing

  const unit = weightUnit === 'kg' ? 'kg' : 'lbs'
  const { lo, hi } = parseRepRange(repRange)
  const last = sessions[sessions.length - 1]
  if (!last || !(+last.weight > 0)) return null // no usable working weight

  // RPE for the most recent session: averaged across any entries sharing its
  // date (usually just one). Missing RPE passes the gate (null → ok).
  const lastRpe = avgRpe(sessions.filter(s => s.date === last.date))

  // ── Rule 1 · INCREASE ──────────────────────────────────────────────────
  if (last.allHitTop && (lastRpe == null || lastRpe <= 8.5)) {
    const inc = incrementFor(exerciseName, unit)
    const weight = round1(+last.weight + inc)
    return {
      weight,
      reps: lo,
      kind: 'increase',
      reason: `Topped the rep range with RPE to spare — add ${inc} ${unit} and rebuild from ${lo}.`,
      display: `${weight}×${lo}`,
    }
  }

  // ── Rule 2 · DELOAD ────────────────────────────────────────────────────
  if (sessions.length >= 3) {
    const last3 = sessions.slice(-3)
    const e = last3.map(s => +s.e1rm || 0)
    const rpe3 = avgRpe(last3)
    if (e.every(v => v > 0)) {
      const change = (e[2] - e[0]) / e[0] // total change across the window
      if (change <= 0.005 && rpe3 != null && rpe3 >= 9) {
        const weight = roundToPlate(+last.weight * 0.9, unit)
        return {
          weight,
          reps: hi,
          kind: 'deload',
          reason: 'Fatigue signal — back off to rebuild.',
          display: `${weight}×${hi}`,
        }
      }
    }
  }

  // ── Rule 3 · HOLD ──────────────────────────────────────────────────────
  const weight = round1(+last.weight)
  return {
    weight,
    reps: hi,
    kind: 'hold',
    reason: `Own ${weight}×${hi} first.`,
    display: `${weight}×${hi}`,
  }
}

/**
 * One-line trend assessment for StatsView, from e1RM over the last ≤3
 * scoring sessions (sessions with a positive e1RM).
 *
 * @param {object} historyEntry - `gym_exercise_history[name]` (may be undefined)
 * @returns {string|null} e.g. "e1RM up 4.2% over 3 sessions — ready to add weight."
 */
export function progressionNote(historyEntry) {
  const sessions = (historyEntry?.sessions || []).filter(s => +s.e1rm > 0)
  if (sessions.length < 2) return null

  const win = sessions.slice(-3)
  const n = win.length
  const first = +win[0].e1rm
  const lastE = +win[n - 1].e1rm
  const pct = ((lastE - first) / first) * 100

  if (pct > 0.5) return `e1RM up ${pct.toFixed(1)}% over ${n} sessions — ready to add weight.`
  if (pct < -0.5) return `e1RM down ${Math.abs(pct).toFixed(1)}% over ${n} sessions — prioritize recovery.`
  return `Flat for ${n} — change the stimulus.`
}
