import { formatDate } from '../../lib/dateHelpers.js'
import { EntryCard, MonthCalendar } from './Journal.jsx'

// Journal Reflect-face card registry (area 'journal_reflect').
//
// The two sections are coupled to Journal's page state (entries, analyses,
// analyzing, calMonth, selectedDay, lockTick) and its analyze handler, so —
// exactly like healthCardRegistries — the widgets read a ctx REF owned by
// Journal.jsx rather than being zero-state self-contained (Goals-style).
// `buildJournalReflectRegistry` runs ONCE per Journal mount (useMemo []) so
// widget identities stay stable: data changes re-RENDER widgets (they read
// ctxRef.current at render) but never REMOUNT them.
//
// Cards are CHROMELESS: today's Reflect face is frameless (a bare eyebrow +
// month calendar, then a stack of `.journal-entry-card` glass cards), so a
// `.dc-card` wrapper would add a frame that isn't there today. Each cell is a
// bounded, internally-scrolling `.dc-journal-cell` (the 5b variable-height rule).
//
// Defaults mirror today's single-column stack: calendar on top (L → full width
// on the 2-col mobile grid), past reflections below (XL → full width). The
// journal column is capped at 760px, so the desktop grid measures ~3 cols and a
// calendar at L spans 2 of 3 — the closest the M/L cap gets to today's
// full-width look. Write face / page header / FlipTitle are untouched.

const ICON_PROPS = {
  width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
}

const ICONS = {
  calendar: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </svg>
  ),
  entries: (
    <svg {...ICON_PROPS}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" />
      <path d="M8 8h8M8 11.5h6" />
    </svg>
  ),
}

// ── Widgets (close over ctxRef; read ctxRef.current at render) ──

function makeCalendarWidget(ctxRef) {
  return function CalendarWidget() {
    const c = ctxRef.current
    return (
      <div className="dc-journal-cell">
        <div className="journal-cal-section-header">
          <span className="journal-eyebrow" style={{ marginBottom: 0 }}>ENTRIES</span>
        </div>
        <MonthCalendar
          entries={c.entries}
          month={c.calMonth}
          onMonthChange={c.setCalMonth}
          onDayClick={c.onDayClick}
          todayStr={c.todayStr}
        />
      </div>
    )
  }
}

function makeEntriesWidget(ctxRef) {
  return function EntriesWidget() {
    const c = ctxRef.current
    return (
      <div className="dc-journal-cell">
        <div className="journal-eyebrow">PAST REFLECTIONS</div>
        {c.allSortedEntries.length === 0 ? (
          <div className="journal-day-panel-empty">No reflections yet — flip back and write your first.</div>
        ) : (
          <div className="journal-past-list">
            {(() => {
              let lastDate = null
              let todayCardShown = false
              return c.allSortedEntries.map(entry => {
                const isNewDate = entry.date !== lastDate
                lastDate = entry.date
                const dateLabel = entry.date === c.todayStr ? 'Today' : formatDate(entry.date)
                const isLatestToday = entry.date === c.todayStr && !todayCardShown
                if (isLatestToday) todayCardShown = true
                return (
                  <div key={`${entry.id}-${c.lockTick}`}>
                    {isNewDate && <div className="journal-past-date-label">{dateLabel}</div>}
                    <EntryCard
                      entry={entry}
                      onAnalyze={c.analyzeEntry}
                      analysis={c.analyses[entry.id]}
                      isAnalyzing={c.analyzing[entry.id]}
                      isLatestToday={isLatestToday}
                    />
                  </div>
                )
              })
            })()}
          </div>
        )}
      </div>
    )
  }
}

// ── Registry (area 'journal_reflect') ──

export const JOURNAL_REFLECT_ORDER = ['calendar', 'entries']

export function buildJournalReflectRegistry(ctxRef) {
  return {
    calendar: {
      title: 'Entries Calendar',
      icon: ICONS.calendar,
      component: makeCalendarWidget(ctxRef),
      chromeless: true,
      sizes: ['M', 'L'],
      defaultSize: 'L',
      autoPriority: 1,
      autoSize: { 2: 'L', 3: 'L', 4: 'L' },
    },
    entries: {
      title: 'Past Reflections',
      icon: ICONS.entries,
      component: makeEntriesWidget(ctxRef),
      chromeless: true,
      sizes: ['L', 'XL'],
      defaultSize: 'XL',
      autoPriority: 2,
      autoSize: { 2: 'XL', 3: 'XL', 4: 'XL' },
    },
  }
}
