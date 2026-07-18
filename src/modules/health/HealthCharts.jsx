import {
  AreaChart, Area, BarChart, Bar, Cell,
  ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'

// ── Stage colors ──

const STAGE_COLORS = {
  deep:  '#7048E8',
  rem:   '#E8590C',
  light: '#F59F00',
  awake: '#868E96',
}

// ── Formatters ──

function fmtMonthDay(dateStr) {
  const dt = new Date(dateStr + 'T12:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtWeekday(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}

function fmtMin(v) {
  if (!v) return '0m'
  const h = Math.floor(v / 60)
  const m = v % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Shared chart config ──

const TICK_STYLE = { fill: 'rgba(255,255,255,0.28)', fontSize: 10, fontFamily: 'Geist Mono, monospace' }
const AXIS_PROPS = { axisLine: false, tickLine: false, tick: TICK_STYLE }
const GRID_PROPS = { vertical: false, stroke: 'rgba(255,255,255,0.05)' }

// ── Glass tooltip ──

function GlassTooltip({ active, payload, label, renderContent }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip-glass">
      <div className="chart-tooltip-label">{label}</div>
      {renderContent
        ? renderContent(payload)
        : payload.filter(p => p.value != null).map((p, i) => (
          <div key={i} className="chart-tooltip-row">
            <span className="chart-tooltip-name" style={{ color: p.color }}>{p.name}</span>
            <span className="chart-tooltip-value">{p.value}</span>
          </div>
        ))
      }
    </div>
  )
}

// ── 1. Sleep Trend — 14-day hours area + efficiency line ──

export function SleepTrendChart({ history, fill }) {
  const data = history.slice(-14).map(d => {
    const s         = d.sleep_stages
    const asleepMin = s ? (s.deep + s.light + s.rem) : null
    const totalMin  = s ? (s.deep + s.light + s.rem + (s.wake ?? 0)) : null
    // Cap at 10 so the axis reads "10+" for anything beyond
    const hours = asleepMin != null ? Math.min(+(asleepMin / 60).toFixed(1), 10) : null
    const eff   = (asleepMin != null && totalMin > 0) ? Math.round(asleepMin / totalMin * 100) : null
    return { date: fmtMonthDay(d.date), hours, eff }
  })

  return (
    <div className="health-chart-card">
      <div className="health-chart-header">
        <span className="health-card-label">Sleep Trend</span>
        <span className="health-chart-meta">14 days</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="sleepHoursFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#7000FF" stopOpacity={0.75} />
              <stop offset="100%" stopColor="#7000FF" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} interval="preserveStartEnd" />
          <YAxis
            yAxisId="left"
            {...AXIS_PROPS}
            domain={[0, 10]}
            ticks={[0, 2, 4, 6, 8, 10]}
            tickFormatter={v => v === 10 ? '10+' : v === 0 ? '' : `${v}h`}
          />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} hide />
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
            content={
              <GlassTooltip renderContent={pl => {
                const h = pl.find(p => p.dataKey === 'hours')?.value
                const e = pl.find(p => p.dataKey === 'eff')?.value
                return (
                  <>
                    {h != null && (
                      <div className="chart-tooltip-row">
                        <span className="chart-tooltip-name" style={{ color: '#8B5CF6' }}>Hours</span>
                        <span className="chart-tooltip-value">{h >= 10 ? '10+h' : `${h}h`}</span>
                      </div>
                    )}
                    {e != null && (
                      <div className="chart-tooltip-row">
                        <span className="chart-tooltip-name" style={{ color: 'rgba(255,255,255,0.35)' }}>Efficiency</span>
                        <span className="chart-tooltip-value">{e}%</span>
                      </div>
                    )}
                  </>
                )
              }} />
            }
          />
          <Area
            yAxisId="left"
            type="monotone" dataKey="hours" name="Hours"
            stroke="#7000FF" strokeWidth={2}
            fill="url(#sleepHoursFill)"
            dot={false} activeDot={{ r: 4, fill: '#7000FF', strokeWidth: 0 }}
            isAnimationActive animationDuration={900} animationEasing="ease-out"
          />
          <Line
            yAxisId="right"
            type="monotone" dataKey="eff" name="Efficiency"
            stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} strokeDasharray="5 4"
            dot={false} activeDot={{ r: 3, fill: 'rgba(255,255,255,0.45)', strokeWidth: 0 }}
            isAnimationActive animationDuration={900} animationEasing="ease-out"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── 2. HRV Trend — 30-day with baseline band ──

export function HRVTrendChart({ history, fill }) {
  const data = history
    .filter(d => d.hrv != null)
    .slice(-30)
    .map(d => ({ date: fmtMonthDay(d.date), hrv: Math.round(d.hrv) }))

  const vals = data.map(d => d.hrv)
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  const sd   = mean != null && vals.length > 1
    ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)
    : 5
  const lo = mean != null ? Math.round(mean - sd) : null
  const hi = mean != null ? Math.round(mean + sd) : null

  return (
    <div className="health-chart-card">
      <div className="health-chart-header">
        <span className="health-card-label">HRV</span>
        <span className="health-chart-meta">30 days · baseline ±1 SD</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="hrvTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#00C896" stopOpacity={0.75} />
              <stop offset="100%" stopColor="#00C896" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} interval="preserveStartEnd" />
          <YAxis {...AXIS_PROPS} />
          {lo != null && hi != null && (
            <ReferenceArea y1={lo} y2={hi} fill="rgba(0,200,150,0.09)" stroke="none" />
          )}
          {mean != null && (
            <ReferenceLine y={mean} stroke="rgba(0,200,150,0.3)" strokeDasharray="4 3" strokeWidth={1} />
          )}
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
            content={
              <GlassTooltip renderContent={pl => (
                <>
                  <div className="chart-tooltip-row">
                    <span className="chart-tooltip-name" style={{ color: '#00C896' }}>HRV</span>
                    <span className="chart-tooltip-value">{pl[0]?.value} ms</span>
                  </div>
                  {mean != null && (
                    <div className="chart-tooltip-row">
                      <span className="chart-tooltip-name" style={{ color: 'rgba(255,255,255,0.3)' }}>Baseline</span>
                      <span className="chart-tooltip-value" style={{ color: 'rgba(255,255,255,0.45)' }}>{Math.round(mean)} ms</span>
                    </div>
                  )}
                </>
              )} />
            }
          />
          <Area
            type="monotone" dataKey="hrv" name="HRV (ms)"
            stroke="#00C896" strokeWidth={2}
            fill="url(#hrvTrendFill)"
            dot={false} activeDot={{ r: 4, fill: '#00C896', strokeWidth: 0 }}
            isAnimationActive animationDuration={900} animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── 3. Resting Heart Rate — 30-day, lower is better ──

export function RestingHRChart({ history, fill }) {
  const data = history
    .filter(d => d.resting_hr != null)
    .slice(-30)
    .map(d => ({ date: fmtMonthDay(d.date), hr: d.resting_hr }))

  const vals = data.map(d => d.hr)
  const mean = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  const minHR = vals.length ? Math.min(...vals) : 0

  return (
    <div className="health-chart-card">
      <div className="health-chart-header">
        <span className="health-card-label">Resting Heart Rate</span>
        <span className="health-chart-meta">30 days · lower is better</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="hrTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#E8A020" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#E8A020" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} interval="preserveStartEnd" />
          <YAxis {...AXIS_PROPS} domain={['dataMin - 3', 'dataMax + 3']} />
          {mean != null && (
            <>
              <ReferenceArea y1={minHR - 3} y2={mean - 2} fill="rgba(107,227,164,0.07)" stroke="none" />
              <ReferenceLine y={mean} stroke="rgba(232,160,32,0.32)" strokeDasharray="4 3" strokeWidth={1} />
            </>
          )}
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
            content={
              <GlassTooltip renderContent={pl => {
                const val = pl[0]?.value
                const good = mean != null && val != null && val < mean
                return (
                  <>
                    <div className="chart-tooltip-row">
                      <span className="chart-tooltip-name" style={{ color: good ? '#6BE3A4' : '#E8A020' }}>HR</span>
                      <span className="chart-tooltip-value">{val} bpm</span>
                    </div>
                    {mean != null && (
                      <div className="chart-tooltip-row">
                        <span className="chart-tooltip-name" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          {good ? '↓ Below avg' : `avg ${mean} bpm`}
                        </span>
                      </div>
                    )}
                  </>
                )
              }} />
            }
          />
          <Area
            type="monotone" dataKey="hr" name="Resting HR (bpm)"
            stroke="#E8A020" strokeWidth={2}
            fill="url(#hrTrendFill)"
            dot={false} activeDot={{ r: 4, fill: '#E8A020', strokeWidth: 0 }}
            isAnimationActive animationDuration={900} animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── 4. Sleep Stages — 7-day stacked bar ──

export function SleepStagesChart({ history }) {
  const data = history.slice(-7).map(d => {
    const s = d.sleep_stages
    return {
      date:  fmtWeekday(d.date),
      deep:  s?.deep  ?? 0,
      light: s?.light ?? 0,
      rem:   s?.rem   ?? 0,
      awake: s?.wake  ?? 0,
    }
  })

  return (
    <div className="health-chart-card">
      <div className="health-chart-header">
        <span className="health-card-label">Sleep Stages</span>
        <span className="health-chart-meta">7 days</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} tickFormatter={v => v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={
              <GlassTooltip renderContent={pl => (
                [
                  { key: 'deep',  label: 'Deep',  color: STAGE_COLORS.deep },
                  { key: 'light', label: 'Light', color: STAGE_COLORS.light },
                  { key: 'rem',   label: 'REM',   color: STAGE_COLORS.rem },
                  { key: 'awake', label: 'Awake', color: STAGE_COLORS.awake },
                ]
                  .map(({ key, label, color }) => {
                    const entry = pl.find(p => p.dataKey === key)
                    return entry?.value > 0 ? (
                      <div key={key} className="chart-tooltip-row">
                        <span className="chart-tooltip-name" style={{ color }}>{label}</span>
                        <span className="chart-tooltip-value">{fmtMin(entry.value)}</span>
                      </div>
                    ) : null
                  })
              )} />
            }
          />
          <Bar dataKey="deep"  stackId="s" fill={STAGE_COLORS.deep}  isAnimationActive animationBegin={0}   animationDuration={600} />
          <Bar dataKey="light" stackId="s" fill={STAGE_COLORS.light} isAnimationActive animationBegin={80}  animationDuration={600} />
          <Bar dataKey="rem"   stackId="s" fill={STAGE_COLORS.rem}   isAnimationActive animationBegin={160} animationDuration={600} />
          <Bar dataKey="awake" stackId="s" fill={STAGE_COLORS.awake} radius={[4, 4, 0, 0]} isAnimationActive animationBegin={240} animationDuration={600} />
        </BarChart>
      </ResponsiveContainer>
      <div className="sleep-stages-key">
        {[
          ['deep',  'Deep'],
          ['rem',   'REM'],
          ['light', 'Light'],
          ['awake', 'Awake'],
        ].map(([k, label]) => (
          <span key={k} className="sleep-stages-key-item">
            <span className="sleep-stages-key-dot" style={{ background: STAGE_COLORS[k] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── 5. Weekly Activity — 7-day steps bar with goal line ──

export function WeeklyActivityChart({ history }) {
  const GOAL = 10_000
  const data = history.slice(-7).map(d => ({
    date:  fmtWeekday(d.date),
    steps: d.steps ?? 0,
    _hit:  (d.steps ?? 0) >= GOAL,
  }))

  return (
    <div className="health-chart-card">
      <div className="health-chart-header">
        <span className="health-card-label">Weekly Steps</span>
        <span className="health-chart-meta">Goal 10,000</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -10 }}>
          <defs>
            <linearGradient id="stepsBarFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#E8A020" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#E8A020" stopOpacity={0.3} />
            </linearGradient>
            <linearGradient id="stepsGoalFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#6BE3A4" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#6BE3A4" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
          <ReferenceLine y={GOAL} stroke="#6BE3A4" strokeDasharray="4 3" strokeWidth={1.5} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={
              <GlassTooltip renderContent={pl => {
                const val = pl[0]?.value ?? 0
                const hit = val >= GOAL
                return (
                  <>
                    <div className="chart-tooltip-row">
                      <span className="chart-tooltip-name" style={{ color: hit ? '#6BE3A4' : '#E8A020' }}>Steps</span>
                      <span className="chart-tooltip-value">{val.toLocaleString()}</span>
                    </div>
                    <div className="chart-tooltip-row">
                      <span className="chart-tooltip-name" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {hit ? 'Goal reached ✓' : `${(GOAL - val).toLocaleString()} to go`}
                      </span>
                    </div>
                  </>
                )
              }} />
            }
          />
          <Bar dataKey="steps" name="Steps" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
            {data.map((entry, i) => (
              <Cell key={i} fill={entry._hit ? 'url(#stepsGoalFill)' : 'url(#stepsBarFill)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
