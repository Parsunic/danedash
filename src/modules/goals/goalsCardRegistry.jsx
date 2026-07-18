import AIInsightsCard from './components/AIInsightsCard.jsx'
import HabitsSection from './HabitsSection.jsx'
import GoalsProjectsSection from './GoalsProjectsSection.jsx'
import HabitStatsCard from './HabitStatsCard.jsx'

// Goals-face card registry (area 'goals').
//
// The three sections are fully self-contained: each owns its localStorage reads,
// `sync-applied` listeners and gesture writes, so a STATIC registry works — no
// ctxRef plumbing like Health needs. Each widget just wraps the existing section
// in a `.dc-goals-cell` scroll container. Cards are CHROMELESS: the sections
// already render their own `.ai-insights-card` / `.habits-card` / `.gp-card`
// glass surfaces plus their own section labels, so a `.dc-card` wrapper would
// double-frame them. Fixed-height cells + internal scroll (the variable-height
// list rule) — the sections keep their auto-height content, the cell scrolls.
//
// Defaults mirror today's stacked full-width look: every card defaults to XL
// (full width) in today's order — insights, habits, projects. Users can then
// resize down to M/L in edit mode to build a bento.

const ICON_PROPS = {
  width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
}

const ICONS = {
  insights: (
    <svg {...ICON_PROPS}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    </svg>
  ),
  habits: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="5" width="18" height="14" rx="2" opacity="0.4" />
      <path d="M7 12l2.5 2.5L15 9" />
    </svg>
  ),
  projects: (
    <svg {...ICON_PROPS}>
      <path d="M4 6h10M4 12h7M4 18h12" />
      <path d="M16.5 15.5l1.6 1.6 3.2-3.6" opacity="0.7" />
    </svg>
  ),
  habitstats: (
    <svg {...ICON_PROPS}>
      <path d="M4 20h16" opacity="0.5" />
      <rect x="5" y="12" width="3" height="6" rx="0.6" />
      <rect x="10.5" y="8" width="3" height="10" rx="0.6" />
      <rect x="16" y="4" width="3" height="14" rx="0.6" />
    </svg>
  ),
}

// ── Static widgets (each wraps a self-contained section) ──

function InsightsWidget() {
  return (
    <div className="dc-goals-cell">
      <div className="goals-section-label">AI Insights</div>
      <div className="ai-insights-micro-copy">One honest read on how you're actually doing.</div>
      <AIInsightsCard />
    </div>
  )
}

function HabitsWidget() {
  return (
    <div className="dc-goals-cell">
      <HabitsSection />
    </div>
  )
}

function ProjectsWidget() {
  return (
    <div className="dc-goals-cell">
      <GoalsProjectsSection />
    </div>
  )
}

// ── Registry (area 'goals') ──

export const GOALS_ORDER = ['insights', 'habits', 'projects']

// Module-level const → stable identity across renders (CardGrid effects key off
// registry/defaultOrder identity). No ctxRef, so nothing to rebuild per mount.
export const GOALS_REGISTRY = {
  insights: {
    title: 'AI Insights',
    icon: ICONS.insights,
    component: InsightsWidget,
    chromeless: true,
    sizes: ['M', 'L', 'XL'],
    defaultSize: 'XL',
    autoPriority: 1,
    autoSize: { 2: 'M', 3: 'L', 4: 'L' },
  },
  habits: {
    title: 'Habits',
    icon: ICONS.habits,
    component: HabitsWidget,
    chromeless: true,
    sizes: ['M', 'L', 'XL'],
    defaultSize: 'XL',
    autoPriority: 2,
    autoSize: { 2: 'M', 3: 'L', 4: 'L' },
  },
  projects: {
    title: 'Goals & Projects',
    icon: ICONS.projects,
    component: ProjectsWidget,
    chromeless: true,
    sizes: ['L', 'XL'],
    defaultSize: 'XL',
    autoPriority: 3,
    autoSize: { 2: 'L', 3: 'XL', 4: 'XL' },
  },
}
