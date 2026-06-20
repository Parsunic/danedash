export const DSHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
export const DFULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export const RT_CIRC = 2 * Math.PI * 42

export function gymUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

export function calcE1RM(weight, reps) {
  return Math.round(weight * (1 + reps / 30) * 10) / 10
}

const COMPOUND_RE = /squat|deadlift|bench\s*(press)?|overhead\s*press|\bohp\b|barbell\s*row|bent.over|rdl|hip\s*thrust/i
export function weightInc(name) { return COMPOUND_RE.test(name) ? 5 : 2.5 }

export function parseRepRange(str) {
  const m = String(str || '').match(/(\d+)\s*[-–—]\s*(\d+)/)
  if (m) return { lo: +m[1], hi: +m[2] }
  const n = parseInt(str)
  return isNaN(n) ? { lo: 8, hi: 10 } : { lo: n, hi: n }
}

export function getExRec(exName, repRange, exHistory) {
  const h = exHistory[exName]
  if (!h || !h.sessions || !h.sessions.length) return { seed: true, suggest: null }
  const s = h.sessions, last = s[s.length - 1]
  const { lo, hi } = parseRepRange(repRange)
  const unit = getWeightUnit()
  const e1rmStr = last.e1rm ? `e1RM ${last.e1rm} · ` : ''
  const lastStr = `Last: ${last.weight} ${unit} × ${last.reps}/${hi} @ RPE ${last.rpe}`
  const deload = s.length >= 2 && s[s.length-1].rpe >= 9 && s[s.length-2].rpe >= 9 && s[s.length-1].weight === s[s.length-2].weight
  let sW = last.weight, sR = lo, tag = '', tc = ''
  if (deload) {
    sW = Math.round(last.weight * 0.875 / 2.5) * 2.5; tag = '⚠ Deload'; tc = 'deload'
  } else if (last.allHitTop && last.rpe <= 8) {
    sW = last.weight + weightInc(exName); tag = 'Double Progression'
  } else if (last.allHitTop && last.rpe >= 9) {
    sR = hi; tag = 'Hold — RPE High'; tc = 'hold'
  } else {
    sR = Math.min(last.reps + 2, hi); tag = 'Add Reps'; tc = 'hold'
  }
  return { seed: false, e1rmStr, e1rm: last.e1rm || null, lastStr, sW, sR, tag, tc, unit, suggest: { weight: sW, reps: sR } }
}

export function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${String(m % 60).padStart(2,'0')}m` : `${m}:${String(s % 60).padStart(2,'0')}`
}

export function getWeightUnit() {
  try { return (JSON.parse(localStorage.getItem('gym_settings')) || {}).weightUnit || 'lbs' } catch { return 'lbs' }
}
