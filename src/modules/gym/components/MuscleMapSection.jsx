import { useState, useEffect, useMemo } from 'react'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { RADAR_GROUPS, DEFAULT_SUB_MUSCLES, ALL_SUB_MUSCLES } from '../../../lib/subMuscleData.js'
import { getCustomExercises } from '../../../lib/muscleUtils.js'
import BodySVG from './BodySVG.jsx'
import { supabase } from '../../../lib/supabase.js'

const ACCENT = '#E8A020'

// ── SUPABASE SUB-MUSCLE LOOKUP ────────────────────────────────────────────

let subMuscleCache = null

async function fetchSubMuscles() {
  if (subMuscleCache) return subMuscleCache
  const { data } = await supabase
    .from('exercises')
    .select('name, primary_sub_muscles, secondary_sub_muscles')
  subMuscleCache = new Map(
    (data || []).map(e => [e.name.toLowerCase(), {
      primary:   e.primary_sub_muscles   || [],
      secondary: e.secondary_sub_muscles || [],
    }])
  )
  // Merge custom exercises (may have AI-generated sub-muscles)
  for (const ex of getCustomExercises()) {
    if (ex.primary_sub_muscles || ex.secondary_sub_muscles) {
      subMuscleCache.set(ex.name.toLowerCase(), {
        primary:   ex.primary_sub_muscles   || [],
        secondary: ex.secondary_sub_muscles || [],
      })
    }
  }
  return subMuscleCache
}

// ── DATA BUILDERS ─────────────────────────────────────────────────────────

function getWeekDateRange() {
  const now = new Date()
  const sun = new Date(now)
  sun.setDate(now.getDate() - now.getDay())
  sun.setHours(0, 0, 0, 0)
  const sat = new Date(sun)
  sat.setDate(sun.getDate() + 7)
  return { sun, sat }
}

function toDateObj(ds) {
  return ds ? new Date(ds + 'T00:00:00') : null
}

// Given workout logs + sub-muscle map, compute active sub-muscles for a time window.
// Returns { primary: Set, secondary: Set, sets: {sub_muscle: count}, volume: {sub_muscle: number} }
function computeActiveMuscles(logs, subMap, { sun, sat }) {
  const primSets   = {}
  const secSets    = {}
  const primVol    = {}
  const secVol     = {}
  const primCount  = {}
  const secCount   = {}

  for (const log of logs) {
    const d = toDateObj(log.date)
    if (!d || d < sun || d >= sat) continue

    for (const ex of (log.exercises || [])) {
      const key = (ex.name || '').toLowerCase()
      const info = subMap.get(key) ?? DEFAULT_SUB_MUSCLES[ex.primary_muscle] ?? { primary: [], secondary: [] }

      const sets = ex.sets || []
      const numSets = sets.length
      const vol = sets.reduce((s, st) => s + (st.weight || 0) * (st.reps || 0), 0)

      for (const m of info.primary) {
        primSets[m]  = (primSets[m]  || 0) + numSets
        primVol[m]   = (primVol[m]   || 0) + vol
        primCount[m] = (primCount[m] || 0) + 1
      }
      for (const m of info.secondary) {
        secSets[m]  = (secSets[m]  || 0) + numSets
        secVol[m]   = (secVol[m]   || 0) + vol
        secCount[m] = (secCount[m] || 0) + 1
      }
    }
  }

  return { primSets, secSets, primVol, secVol }
}

function buildRadarData(primSets, secSets, primVol, secVol, metric) {
  return Object.entries(RADAR_GROUPS).map(([group, muscles]) => {
    const pVal = muscles.reduce((s, m) => s + (metric === 'sets' ? (primSets[m] || 0) : (primVol[m] || 0)), 0)
    const sVal = muscles.reduce((s, m) => s + (metric === 'sets' ? (secSets[m] || 0) : (secVol[m] || 0)), 0)
    return { group, value: pVal + sVal * 0.4 }
  })
}

// ── CUSTOM RADAR TOOLTIP ──────────────────────────────────────────────────

function RadarTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { group, value } = payload[0]?.payload || {}
  return (
    <div className="gym-chart-tt">
      <div className="gym-chart-tt-label">{group}</div>
      <div className="gym-chart-tt-row">
        <span className="gym-chart-tt-dot" style={{ background: ACCENT }} />
        <span><strong>{Math.round(value)}</strong></span>
      </div>
    </div>
  )
}


// ── MAIN COMPONENT ────────────────────────────────────────────────────────

export default function MuscleMapSection({ logs }) {
  const [metric, setMetric] = useState('sets') // 'sets' | 'volume'
  const [subMap, setSubMap] = useState(null)

  // Fetch sub-muscle data once
  useMemo(() => {
    fetchSubMuscles().then(m => setSubMap(m))
  }, [])

  const { sun, sat } = useMemo(() => getWeekDateRange(), [])

  const { primSets, secSets, primVol, secVol } = useMemo(() => {
    if (!subMap) return { primSets: {}, secSets: {}, primVol: {}, secVol: {} }
    return computeActiveMuscles(logs, subMap, { sun, sat })
  }, [logs, subMap, sun, sat])

  const radarData = useMemo(
    () => buildRadarData(primSets, secSets, primVol, secVol, metric),
    [primSets, secSets, primVol, secVol, metric]
  )

  const maxVal = Math.max(...radarData.map(d => d.value), 1)

  // Primary: muscles with meaningful activity (>0 sets primary)
  const activePrimary   = Object.keys(primSets).filter(m => primSets[m] > 0)
  const activeSecondary = Object.keys(secSets).filter(m => secSets[m] > 0 && !primSets[m])

  const pct = useMemo(() => {
    const hit = ALL_SUB_MUSCLES.filter(m => (primSets[m] || 0) + (secSets[m] || 0) > 0).length
    return Math.round((hit / ALL_SUB_MUSCLES.length) * 100)
  }, [primSets, secSets])

  const hasData = activePrimary.length > 0 || activeSecondary.length > 0

  return (
    <div className="muscle-map-section">
      <div className="muscle-map-header">
        <div>
          <div className="muscle-map-title">Muscles Worked This Week</div>
          <div className="muscle-map-pct">
            <span className="muscle-map-pct-num">{pct}</span>
            <span className="muscle-map-pct-label">%</span>
          </div>
        </div>
        <div className="muscle-map-toggle">
          <button
            className={metric === 'sets' ? 'btn-primary' : 'btn-secondary'}
            style={{ fontSize: '0.72rem', padding: '4px 10px' }}
            onClick={() => setMetric('sets')}
          >Sets</button>
          <button
            className={metric === 'volume' ? 'btn-primary' : 'btn-secondary'}
            style={{ fontSize: '0.72rem', padding: '4px 10px' }}
            onClick={() => setMetric('volume')}
          >Volume</button>
        </div>
      </div>

      {!hasData ? (
        <div className="muscle-map-empty">Log a workout this week to see your muscle map.</div>
      ) : (
        <>
          <BodySVG activePrimary={activePrimary} activeSecondary={activeSecondary} />

          <div className="muscle-map-legend">
            <span className="muscle-map-legend-dot" style={{ background: '#E8A020' }} />
            <span>Primary</span>
            <span className="muscle-map-legend-dot" style={{ background: 'rgba(232,160,32,0.45)' }} />
            <span>Secondary</span>
          </div>

          <div className="muscle-map-radar-wrap">
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData} margin={{ top: 16, right: 30, bottom: 16, left: 30 }}>
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis
                  dataKey="group"
                  tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: 'var(--font-body)' }}
                />
                <Tooltip content={<RadarTip />} />
                <Radar
                  dataKey="value"
                  stroke={ACCENT}
                  strokeWidth={2}
                  fill={ACCENT}
                  fillOpacity={0.22}
                  dot={{ fill: ACCENT, r: 3, strokeWidth: 0 }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}
