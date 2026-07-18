import { useState, useEffect, useMemo } from 'react'
import { formatDate } from '../../lib/dateHelpers.js'
import { storeGet, storeSet } from '../../lib/storage.js'
import { isEntryLocked, AI_MODELS } from './journalUtils.js'
import { EntryCard } from './Journal.jsx'
import MoodDots from './MoodDots.jsx'

// ── Journal Intelligence (F4) — three appended Reflect-face cards ──
//
// browse     : full-text search + tag chips + mood filter over ALL entries,
//              self-contained results list (reuses exported EntryCard).
// moodtrend  : mood-over-time (last ~60 days) hand-rolled SVG line + avg number.
// synthesis  : monthly AI reflection, cached at journal_synthesis:YYYY-MM.
//
// Same contract as journalReflectRegistry: each widget closes over Journal's
// ctxRef (built once, useMemo []), reading ctxRef.current at render so data
// changes RE-RENDER but never REMOUNT. Chromeless cells wrapped in
// .dc-journal-cell so they scroll inside the bounded grid cell.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const ICON_PROPS = {
  width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
}
const ICONS = {
  browse: (
    <svg {...ICON_PROPS}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  moodtrend: (
    <svg {...ICON_PROPS}>
      <path d="M3 16l5-5 4 3 6-7" />
      <path d="M17 7h3v3" />
    </svg>
  ),
  synthesis: (
    <svg {...ICON_PROPS}>
      <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3z" />
      <path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </svg>
  ),
}

// Render **bold** markdown segments (mirrors Journal's renderAnalysis).
function renderRich(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  )
}

// ── Grouped results list (shared shape with the entries card) ──
function ResultsList({ entries, todayStr, lockTick, analyses, analyzing, onAnalyze }) {
  let lastDate = null
  return (
    <div className="journal-past-list dc-journal-browse-results">
      {entries.map(entry => {
        const isNewDate = entry.date !== lastDate
        lastDate = entry.date
        const dateLabel = entry.date === todayStr ? 'Today' : formatDate(entry.date)
        return (
          <div key={`${entry.id}-${lockTick}`}>
            {isNewDate && <div className="journal-past-date-label">{dateLabel}</div>}
            <EntryCard
              entry={entry}
              onAnalyze={onAnalyze}
              analysis={analyses?.[entry.id]}
              isAnalyzing={analyzing?.[entry.id]}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Browse (search + filters) ──
function makeBrowseWidget(ctxRef) {
  return function BrowseWidget() {
    const c = ctxRef.current
    const [raw, setRaw] = useState('')
    const [query, setQuery] = useState('')
    const [tagFilter, setTagFilter] = useState([])
    const [moodFilter, setMoodFilter] = useState(null)

    // Debounced (200ms) case-insensitive text query.
    useEffect(() => {
      const id = setTimeout(() => setQuery(raw.trim().toLowerCase()), 200)
      return () => clearTimeout(id)
    }, [raw])

    const allTags = useMemo(() => {
      const s = new Set()
      c.entries.forEach(e => (e.tags || []).forEach(t => s.add(t)))
      return [...s]
    }, [c.entries])

    const active = query.length > 0 || tagFilter.length > 0 || moodFilter != null

    const results = useMemo(() => {
      if (!active) return []
      return c.entries
        .filter(e => {
          if (query) {
            // Locked entries are sealed — never searched by (hidden) content.
            if (isEntryLocked(e)) return false
            if (!(e.text || '').toLowerCase().includes(query)) return false
          }
          // Tags = OR (any selected tag matches).
          if (tagFilter.length && !(e.tags || []).some(t => tagFilter.includes(t))) return false
          if (moodFilter != null && e.mood !== moodFilter) return false
          return true
        })
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }, [c.entries, query, tagFilter, moodFilter, active])

    const toggleTag = tag =>
      setTagFilter(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])

    return (
      <div className="dc-journal-cell">
        <div className="journal-eyebrow">SEARCH &amp; FILTER</div>
        <input
          className="dc-journal-search"
          type="text"
          placeholder="Search your reflections…"
          value={raw}
          onChange={e => setRaw(e.target.value)}
        />
        {allTags.length > 0 && (
          <div className="dc-journal-chips">
            {allTags.map(t => (
              <button
                key={t}
                className={`journal-tag-pill${tagFilter.includes(t) ? ' active' : ''}`}
                onClick={() => toggleTag(t)}
              >{t}</button>
            ))}
          </div>
        )}
        <div className="dc-journal-browse-filter-row">
          <span className="journal-mood-label">Mood</span>
          <MoodDots value={moodFilter} onChange={setMoodFilter} size="sm" ariaPrefix="Filter mood" />
        </div>

        {!active ? (
          <div className="dc-journal-browse-hint">Search your history — text, tags, mood.</div>
        ) : results.length === 0 ? (
          <div className="dc-journal-browse-hint">No reflections match those filters.</div>
        ) : (
          <ResultsList
            entries={results}
            todayStr={c.todayStr}
            lockTick={c.lockTick}
            analyses={c.analyses}
            analyzing={c.analyzing}
            onAnalyze={c.analyzeEntry}
          />
        )}
      </div>
    )
  }
}

// ── Mood trend ──
function toKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function computeMoodSeries(entries, todayStr) {
  const [ty, tm, td] = todayStr.split('-').map(Number)
  const cutoff = new Date(ty, tm - 1, td)
  cutoff.setDate(cutoff.getDate() - 59) // ~60-day window inclusive
  const cutoffStr = toKey(cutoff)
  const byDate = {}
  entries.forEach(e => {
    if (e.mood == null || !e.date || e.date < cutoffStr) return
    if (!byDate[e.date]) byDate[e.date] = { sum: 0, n: 0 }
    byDate[e.date].sum += e.mood
    byDate[e.date].n += 1
  })
  const points = Object.keys(byDate).sort().map(date => ({ date, value: byDate[date].sum / byDate[date].n }))
  const avg = points.length ? points.reduce((s, p) => s + p.value, 0) / points.length : null
  return { points, avg }
}

// Hand-rolled line (fixed 1..5 domain), stretched to card width — mirrors
// SleepWidget's non-scaling-stroke sparkline. Round dots are omitted on purpose:
// preserveAspectRatio="none" would squash circles into ellipses.
function MoodLine({ points, height }) {
  const W = 100, H = 34, pad = 4
  if (points.length < 2) return null
  const step = (W - pad * 2) / (points.length - 1)
  const yFor = v => pad + (H - pad * 2) * (1 - (Math.max(1, Math.min(5, v)) - 1) / 4)
  const coords = points.map((p, i) => [pad + i * step, yFor(p.value)])
  const line = coords.map((cc, i) => `${i ? 'L' : 'M'}${cc[0].toFixed(1)},${cc[1].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function moodMicro(avg) {
  if (avg == null) return ''
  if (avg >= 4.2) return 'Riding a good stretch.'
  if (avg >= 3.4) return 'Mostly steady lately.'
  if (avg >= 2.6) return 'A mixed run of days.'
  return 'A heavier stretch — be kind to yourself.'
}

function makeMoodTrendWidget(ctxRef) {
  return function MoodTrendWidget({ size }) {
    const c = ctxRef.current
    const { points, avg } = useMemo(
      () => computeMoodSeries(c.entries, c.todayStr),
      [c.entries, c.todayStr]
    )

    if (points.length === 0) {
      return (
        <div className="dc-journal-cell dc-journal-mt">
          <div className="journal-eyebrow">MOOD TREND</div>
          <div className="dc-journal-mt-empty">Log a mood with your next entry.</div>
        </div>
      )
    }

    const isL = size === 'L'
    return (
      <div className="dc-journal-cell dc-journal-mt">
        <div className="journal-eyebrow">MOOD TREND</div>
        <div className="dc-journal-mt-hero">{avg.toFixed(1)}<span className="dc-journal-mt-unit">/5</span></div>
        <div className="dash-widget-label" style={{ marginTop: 2 }}>avg mood · last 60 days</div>
        {points.length >= 2 && (
          <div style={{ marginTop: 12 }}>
            <MoodLine points={points} height={isL ? 54 : 34} />
          </div>
        )}
        <div className="dc-journal-mt-micro">
          {moodMicro(avg)}
          {isL && ` · ${points.length} ${points.length === 1 ? 'day' : 'days'} logged`}
        </div>
      </div>
    )
  }
}

// ── Monthly synthesis ──
function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number)
  return monthKeyFromDate(new Date(y, m - 1 + delta, 1))
}
function monthName(key) {
  const m = Number(key.split('-')[1])
  return MONTHS[m - 1]
}
function readSynthCache(monthKey) {
  return storeGet('journal_synthesis:' + monthKey) || null
}

const SYNTH_SYSTEM = `You are a perceptive, honest journal analyst reflecting on a full month of someone's private journal entries. Do not be sycophantic, vague, or generic. Ground every observation in what they actually wrote.

Respond in EXACTLY three sections, using this markdown format:
**Recurring themes:** 2–3 themes that show up across the month. Be specific.
**A pattern to notice:** One pattern, tension, avoidance, or blind spot the writer may not see in themselves. Name it plainly but kindly.
**One gentle suggestion:** A single, concrete thing to try next month. Not vague self-help — a real step.

Keep the whole response under 320 words. Be direct and warm. Skip affirmations and filler.`

function makeSynthesisWidget(ctxRef) {
  return function SynthesisWidget() {
    const c = ctxRef.current
    const [month, setMonth] = useState(() => monthKeyFromDate(new Date()))
    const [synth, setSynth] = useState(() => readSynthCache(monthKeyFromDate(new Date())))
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    // Re-read cache when the selected month changes.
    useEffect(() => { setSynth(readSynthCache(month)); setError('') }, [month])

    // Re-read cache after a cross-device sync lands (another device generated it).
    useEffect(() => {
      const onSync = () => setSynth(readSynthCache(month))
      window.addEventListener('sync-applied', onSync)
      return () => window.removeEventListener('sync-applied', onSync)
    }, [month])

    const monthEntries = useMemo(
      () => c.entries.filter(e => e.date && e.date.startsWith(month) && !isEntryLocked(e)),
      [c.entries, month]
    )
    const label = monthName(month)
    const nowKey = monthKeyFromDate(new Date())
    const canGoNext = month < nowKey

    const generate = async () => {
      if (loading) return
      const apiKey = localStorage.getItem('anthropic_api_key') || ''
      if (!apiKey) { setError('Add an API key in Settings to generate a synthesis.'); return }
      if (monthEntries.length === 0) { setError(`No unlocked entries in ${label} yet.`); return }
      setLoading(true)
      setError('')
      const model = AI_MODELS[Math.floor(Math.random() * AI_MODELS.length)]
      const corpus = monthEntries
        .slice()
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(e => `[${e.date}] ${e.text}`)
        .join('\n\n')
        .slice(0, 12000)
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
            model,
            max_tokens: 600,
            system: SYNTH_SYSTEM,
            messages: [{ role: 'user', content: `Journal entries for ${label}:\n\n${corpus}` }],
          }),
        })
        const data = await resp.json()
        if (data.error) {
          setError('Synthesis failed. Check your API key.')
        } else {
          const text = data.content[0].text.trim()
          const rec = { text, generated_at: new Date().toISOString(), model, count: monthEntries.length }
          storeSet('journal_synthesis:' + month, rec) // user gesture → syncs
          setSynth(rec)
        }
      } catch (e) {
        console.error('[Journal Synthesis]', e)
        setError('Synthesis failed. Check your connection.')
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="dc-journal-cell dc-journal-synth">
        <div className="dc-journal-synth-head">
          <button className="journal-cal-nav-btn" onClick={() => setMonth(m => shiftMonthKey(m, -1))} aria-label="Previous month">‹</button>
          <span className="dc-journal-synth-title">Reflect on {label}</span>
          <button
            className="journal-cal-nav-btn"
            onClick={() => canGoNext && setMonth(m => shiftMonthKey(m, 1))}
            disabled={!canGoNext}
            aria-label="Next month"
          >›</button>
        </div>

        {synth ? (
          <>
            <div className="journal-analysis-box">{renderRich(synth.text)}</div>
            <div className="dc-journal-synth-actions">
              <button className="btn-ghost" onClick={generate} disabled={loading}>
                {loading ? 'Reflecting…' : 'Regenerate'}
              </button>
              <span className="dc-journal-synth-meta">
                {synth.count} {synth.count === 1 ? 'entry' : 'entries'} · {new Date(synth.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="dc-journal-synth-blurb">
              A monthly read on your themes, patterns, and one thing to try next.
            </p>
            <button className="btn-ghost" onClick={generate} disabled={loading}>
              {loading ? 'Reflecting…' : `Reflect on ${label} →`}
            </button>
          </>
        )}
        {error && <div className="dc-journal-synth-error">{error}</div>}
      </div>
    )
  }
}

// ── Registry entries (spread into buildJournalReflectRegistry) ──
export function buildJournalIntelWidgets(ctxRef) {
  return {
    browse: {
      title: 'Browse & Search',
      icon: ICONS.browse,
      component: makeBrowseWidget(ctxRef),
      chromeless: true,
      sizes: ['L', 'XL'],
      defaultSize: 'XL',
      autoPriority: 3,
      autoSize: { 2: 'XL', 3: 'XL', 4: 'XL' },
    },
    moodtrend: {
      title: 'Mood Trend',
      icon: ICONS.moodtrend,
      component: makeMoodTrendWidget(ctxRef),
      chromeless: true,
      sizes: ['M', 'L'],
      defaultSize: 'M',
      autoPriority: 4,
      autoSize: { 2: 'M', 3: 'L', 4: 'L' },
    },
    synthesis: {
      title: 'Monthly Synthesis',
      icon: ICONS.synthesis,
      component: makeSynthesisWidget(ctxRef),
      chromeless: true,
      sizes: ['L', 'XL'],
      defaultSize: 'L',
      autoPriority: 5,
      autoSize: { 2: 'L', 3: 'L', 4: 'XL' },
    },
  }
}
