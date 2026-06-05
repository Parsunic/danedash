# UltraDash — Claude Context

## Project Goal
Personal life management PWA: Dashboard, To-Do, Gym, Calendar, Journal, and Health (all implemented; Finances planned). High priority on sleek UI with nice graphs and data. Works on **mobile** (primary use) and **desktop** (enhanced multi-column layouts, with more in depth planning and statistic features on desktop). Deployed to Netlify and Vercel, auto-synced from GitHub.

## Auto-Deploy — CRITICAL
A PostToolUse hook **automatically commits and pushes** after every `Write` or `Edit` tool call. **Never run git commands manually** in this project. The hook handles all version control.

## Stack
- Vite + React 18, React Router v6
- Single CSS file: `src/styles/globals.css` (~2000+ lines, no CSS modules)
- Dark theme: `#050506` bg, `#E8A020` warm amber (`--accent`), `#6BE3A4` success green (`--success`), `#F2C063` secondary amber (`--warning`)
- Fonts: `var(--font-body)` (Geist Sans), `var(--font-display)` (Plus Jakarta Sans), `var(--font-mono)` (Geist Mono)

## Data Layer
- **localStorage** is primary — `storeGet`/`storeSet` from `src/lib/storage.js`
- **Supabase** blob sync via `src/contexts/SyncContext.jsx` (`app_state` table, keyed by `key`)
- Active date: `getActiveDateString()` from `src/lib/dateHelpers.js`
- Cross-module events: `window.dispatchEvent(new Event('gym-changed'))`, `'goals-changed'`, `'schedule-sync'`

## Anthropic API
AI calls are made directly from the browser (no proxy) across multiple modules. API key stored in `localStorage` as `anthropic_api_key`, entered via Settings modal in `src/components/Layout.jsx`.

## Desktop Layout Pattern
- Breakpoint: `window.matchMedia('(min-width: 1024px)').matches` — computed once at module scope (not reactive)
- CSS: `@media (min-width: 1024px)` blocks in `globals.css`
- `page-wrap` max-width: 1440px, centered
- Sidebar width: `var(--sidebar-w)` (~180px on desktop)

## Directory Structure
```
src/
  App.jsx                    # Route definitions + modules array (used by nav)
  main.jsx
  components/
    Layout.jsx               # Shell: sidebar + bottom nav + settings modal + sync status
    Sidebar.jsx              # Desktop sidebar nav
    BottomNav.jsx            # Mobile bottom tab bar
  contexts/
    SyncContext.jsx          # Supabase sync provider
  lib/
    storage.js               # storeGet / storeSet
    dateHelpers.js           # getActiveDateString
  styles/
    globals.css              # ALL CSS (single file)
  modules/
    dashboard/
      Dashboard.jsx          # DayRing, GoalTicker, TopTasksWidget, CalendarNowWidget
                             # Desktop: 2-col grid (ring | widgets)
    todo/
      Todo.jsx               # Goals (today/tomorrow), recurring tasks
                             # Queue feature: goal.queued=true marks high-priority (⚡ button)
                             # Desktop: 2-col grid (today | tomorrow)
    gym/
      Gym.jsx                # Shell: mobile 6-tab / desktop 3-col layout + rest timer
      gymUtils.js            # gymUUID, calcE1RM, parseRepRange, DSHORT, DFULL, MONTHS, dateToStr
      components/
        TemplatesView.jsx    # Workout templates CRUD — collapsible cards (collapsed by default)
        PlannerView.jsx      # Weekly planner grid + week templates (collapsible section)
                             # desktopMode prop: shows exercise list inside day cells
        AICoachView.jsx      # Anthropic API → populates planner; ONLY file making AI calls
        LogView.jsx          # Active workout logger (mobile primary)
        HistoryView.jsx      # Past workout sessions (expandable)
        RestTimer.jsx        # Rest timer overlay
        StatsView.jsx        # Exercise stats + search bar (skeleton — graphs coming later)
    calendar/
      Calendar.jsx           # Shell: day (default) / week / month views
      TimeGrid.jsx           # Hour-by-hour grid for day/week
      MonthView.jsx          # Month grid
      MiniMonth.jsx          # Mini calendar overlay inside TimeGrid
      EventModal.jsx         # Create/edit event form
      calendarUtils.js       # getDayEvents, getWeekDays, gymPlannedToEvent, etc.
                             # getDayEvents merges calendar_events + gym_planned for a day
```

## Key Data Shapes
- **Goal/To-Do**: `{ id, text, done, queued?, date }` — stored at `goals:YYYY-MM-DD`
- **Gym planned**: `{ id, date, name, templateId, exercises[], status }` — stored at `gym_planned`
- **Gym template**: `{ id, name, exercises[{name, sets, repRange, notes}] }` — stored at `gym_templates`
- **Gym history**: keyed by exercise name, `{ allTimePR, sessions[{date, weight, reps, rpe, e1rm, allHitTop}] }` — stored at `gym_exercise_history`
- **Calendar event**: `{ id, title, start_time, end_time, is_all_day, color?, user_id, created_at }`

## Gym Desktop Layout (3-col)
```
| Templates (240px) | Planner (1fr) | Panel (320px) |
                                     AI Coach / History / Stats
```
Templates: collapsed cards, click to expand.
Planner: `desktopMode` prop shows exercises inside day cells; Week Templates section is collapsible.
Panel: tab-switched between AI Coach, History, Stats.

## Calendar Header Labels (day view)
- Today → "Today" | Yesterday → "Yesterday" | Tomorrow → "Tomorrow"
- +2 to +7 days → weekday name (e.g. "Wednesday")
- Beyond 7 days or past → "Month Nth" (e.g. "June 2nd")

## Design System

### Accent Color
Single accent: #E8A020 (warm amber). Use this exact hex universally —
active states, CTAs, progress rings, streak counters, hover indicators.
No Tailwind approximations like amber-400. Import as a CSS variable --accent.

### Typography
- UI font: Geist Sans (via next/font/google or CDN) — `var(--font-body)`. Default for all controls, inputs, and body copy.
- Display font: Plus Jakarta Sans, weight 300–500 (for large headings, date heroes, streak numbers, primary data-entry inputs like weight/reps). Applied via `var(--font-display)`. Do not use Instrument Serif.
- Monospace: Geist Mono (`var(--font-mono)`) for **displayed** secondary data only — e1RM strings, timestamps, RPE badges, set history table cells, log metadata. Never on input fields or controls.
- Section labels: uppercase, tracking-widest, text-xs, muted (opacity 40%).
  Never bold. This is a whisper, not a shout.

### Cards
All cards: bg-white/[0.04], border border-white/[0.06], rounded-xl, p-6.
No exceptions. No mixing border styles.

### Background Blob
Each tab has one large blurred radial gradient blob (accent color,
opacity 0.08–0.12, blur-3xl, pointer-events-none, fixed, z-0).
Blob breathes via keyframe: slow scale (1 → 1.15) + opacity pulse over 8s,
ease-in-out, infinite alternate.

Per-tab blob position and drift:
- Dashboard: top-right, drifts 20px down-left on breathe cycle
- To-Do: center-left (30% from left, 50% down), slow clockwise circular drift
- Gym: bottom-right, slow upward drift 30px
- Calendar: top-left, drifts 25px right
- Journal: dead center, minimal drift, emphasis on opacity pulse

### Sidebar
Active item: left accent bar only (border-l-2 border-[--accent],
bg-transparent). Remove background highlight slab.

### Micro-copy Principle
Every card should have one "voice" line — motivational, conversational,
human. Ex: "One down. Don't stop now." This is not optional decoration.

### Emotional Data Principle
Data should feel like a conversation with yourself, not a spreadsheet.
Big number → tiny label beneath → micro-copy. This hierarchy is sacred.



Feel free to add to this file as you go, but only add information you think is critical to the project.