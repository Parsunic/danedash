// readinessUtils.js — pure derivations for Training Readiness (F2).
//
// Everything here is DERIVED at render time from existing data sources
// (health_metrics rows via fetchHealthHistory + gym_workout_logs via storeGet)
// and is NEVER persisted — no new storage or sync keys.
//
// computeReadiness carries Health.jsx's exact readiness weighting (the Overview
// ring): sleep .4 / HRV .4 / resting-HR .2 vs 30-day baselines, renormalized
// over whichever inputs exist. Health.jsx imports readinessFromHistory from
// here, so the Overview ring, the verdict card, the readiness trend, and the
// dashboard Readiness widget can never drift apart.

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

// ── Date helpers (local time, matching the app's YYYY-MM-DD convention) ──

function pad2(n) {
  return String(n).padStart(2, '0')
}

export function localTodayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function shiftDateStr(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + deltaDays)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// ── Readiness (exact Health.jsx weighting — do not tweak independently) ──

export function computeBaselines(history) {
  const last30 = (history ?? []).slice(-30)
  return {
    avgHRV: avg(last30.filter(d => d.hrv != null).map(d => d.hrv)),
    avgHR:  avg(last30.filter(d => d.resting_hr != null).map(d => d.resting_hr)),
  }
}

// Per-input component scores (0–100 each, null when the input or its baseline
// is missing). Exposed so the dashboard widget can show a contribution row.
export function readinessParts(row, baselines) {
  if (!row) return { sleep: null, hrv: null, rhr: null }
  const { avgHRV, avgHR } = baselines ?? {}
  const sleep = row.sleep_score ?? null
  const hrv = row.hrv != null && avgHRV != null
    ? Math.min(100, Math.max(0, 50 + ((row.hrv - avgHRV) / avgHRV) * 150))
    : null
  const rhr = row.resting_hr != null && avgHR != null
    ? Math.min(100, Math.max(0, 50 + ((avgHR - row.resting_hr) / avgHR) * 200))
    : null
  return { sleep, hrv, rhr }
}

export function computeReadiness(row, baselines) {
  const { sleep, hrv, rhr } = readinessParts(row, baselines)
  const parts = []
  if (sleep != null) parts.push([sleep, 0.4])
  if (hrv   != null) parts.push([hrv,   0.4])
  if (rhr   != null) parts.push([rhr,   0.2])
  if (!parts.length) return null
  const totalW = parts.reduce((s, [, w]) => s + w, 0)
  return Math.round(parts.reduce((s, [v, w]) => s + v * (w / totalW), 0))
}

// Convenience matching Health.jsx's historical signature.
export function readinessFromHistory(row, history) {
  return computeReadiness(row, computeBaselines(history))
}

// Per-day readiness over the fetched history. Day i uses baselines from the
// trailing ≤30-row window ENDING at i (inclusive), so the final point equals
// readinessFromHistory(lastRow, rows) — i.e. exactly the Overview ring's
// number when rows is the fetched 30-day history. Rows lacking every input
// (no sleep score AND no baselined HRV/RHR) are skipped.
export function readinessSeries(rows) {
  const list = rows ?? []
  const out = []
  list.forEach((row, i) => {
    const win = list.slice(Math.max(0, i - 29), i + 1)
    const r = computeReadiness(row, computeBaselines(win))
    if (r != null) out.push({ date: row.date, readiness: r })
  })
  return out
}

// ── Training volume (matches gym StatsView: Σ weight × reps over all sets) ──

export function logVolume(log) {
  return (log?.exercises ?? []).reduce((s, ex) =>
    s + (ex.sets ?? []).reduce((s2, set) => s2 + (set.weight || 0) * (set.reps || 0), 0), 0)
}

export function dayVolume(logs, dateStr) {
  return (logs ?? []).filter(l => l?.date === dateStr).reduce((s, l) => s + logVolume(l), 0)
}

// Daily totals for the `days` calendar days ENDING at endDateStr (inclusive),
// oldest → newest. Days without a logged workout are 0.
export function recentDailyVolumes(logs, endDateStr, days = 7) {
  const out = []
  for (let i = days - 1; i >= 0; i--) out.push(dayVolume(logs, shiftDateStr(endDateStr, -i)))
  return out
}

// Builds trainingVerdict's volume inputs from gym_workout_logs:
// recentVolumes = the 7 daily totals ending YESTERDAY (inclusive).
export function verdictInputs(logs, todayStr = localTodayStr()) {
  const recentVolumes = recentDailyVolumes(logs, shiftDateStr(todayStr, -1), 7)
  return { yesterdayVolume: recentVolumes[recentVolumes.length - 1], recentVolumes }
}

// ── Training verdict ──
//
// VERDICT THRESHOLDS (kept simple and explainable):
//   Readiness base:   >= 75 → 'Train hard' | 50–74 → 'Steady' | < 50 → 'Go easy'
//   Volume modifier:  a day counts as "heavy" when its volume is >= 1.25× the
//     average of the NONZERO days in recentVolumes (needs >= 2 training days in
//     the window to establish a norm). If yesterday was heavy AND the day
//     before was also a training day (back-to-back load), the verdict is
//     demoted one step — 'Train hard' → 'Steady' ("recovery debt"),
//     'Steady' → 'Go easy'. The modifier only ever demotes, never promotes.
//   No readiness data → { verdict: null, reason: 'No health data yet.' }
//
// recentVolumes: daily totals ending yesterday (inclusive), oldest → newest —
// see verdictInputs().
export function trainingVerdict({ todayReadiness, yesterdayVolume, recentVolumes }) {
  if (todayReadiness == null) return { verdict: null, reason: 'No health data yet.' }

  let verdict = todayReadiness >= 75 ? 'Train hard' : todayReadiness >= 50 ? 'Steady' : 'Go easy'
  let reason =
    verdict === 'Train hard' ? 'Recovered and ready. Push today.' :
    verdict === 'Steady'     ? 'Decent recovery. Keep it controlled.' :
    'Low readiness. Recovery is the workout.'

  const vols = Array.isArray(recentVolumes) ? recentVolumes : []
  const trained = vols.filter(v => v > 0)
  const norm = trained.length >= 2 ? avg(trained) : null
  const yV = yesterdayVolume ?? (vols.length ? vols[vols.length - 1] : 0)
  const dayBefore = vols.length >= 2 ? vols[vols.length - 2] : 0

  if (norm != null && yV >= norm * 1.25 && dayBefore > 0) {
    if (verdict === 'Train hard') {
      verdict = 'Steady'
      reason = 'Recovery debt — two big days back to back.'
    } else if (verdict === 'Steady') {
      verdict = 'Go easy'
      reason = 'Back-to-back load on middling recovery. Ease off.'
    }
  }
  return { verdict, reason }
}

// ── Sleep → performance correlation ──
//
// health_metrics buckets sleep by WAKE-UP day (googleFitSync parseSleep), so
// the sleep_score stored on date D is the night that ENDED on the morning of
// D — pairing D's sleep_score with D's training volume is exactly "prior-night
// sleep vs that day's session". Pearson r over the pairs; null when n < 2 or
// either series has zero variance (r undefined).
export function sleepPerformancePairs(healthRows, gymLogs) {
  const volByDate = {}
  ;(gymLogs ?? []).forEach(l => {
    if (!l?.date) return
    const v = logVolume(l)
    if (v > 0) volByDate[l.date] = (volByDate[l.date] ?? 0) + v
  })

  const pairs = []
  ;(healthRows ?? []).forEach(row => {
    if (row?.sleep_score == null) return
    const v = volByDate[row.date]
    if (v == null) return
    pairs.push({ date: row.date, sleep: row.sleep_score, volume: v })
  })

  return {
    pairs,
    n: pairs.length,
    r: pearson(pairs.map(p => p.sleep), pairs.map(p => p.volume)),
  }
}

function pearson(xs, ys) {
  const n = xs.length
  if (n < 2) return null
  const mx = avg(xs)
  const my = avg(ys)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}
