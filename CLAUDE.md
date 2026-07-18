# UltraDash — Claude Context

## Project Goal
Personal life management PWA: Dashboard, To-Do, Gym, Calendar, Journal, and Health (all implemented; Finances planned). High priority on sleek UI with nice graphs and data. Works on **mobile** (primary use) and **desktop** (enhanced multi-column layouts, with more in depth planning and statistic features on desktop). Deployed to Netlify and Vercel, auto-synced from GitHub.

## Auto-Deploy — CRITICAL
A PostToolUse hook **automatically commits and pushes** after every `Write` or `Edit` tool call. **Never run git commands manually** in this project. The hook handles all version control.

## Supabase — Direct SQL Access
Project ref: `wlrdwrlxkjgubdmntfxl` (URL: `https://wlrdwrlxkjgubdmntfxl.supabase.co`, anon key in `src/lib/supabase.js`).
A Supabase personal access token is stored as the user-level env var `SUPABASE_ACCESS_TOKEN`. Use it to run SQL directly via the Management API (e.g. to inspect/fix RLS policies, schema changes):

```powershell
$env:SUPABASE_ACCESS_TOKEN = [System.Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN','User')
$headers = @{ Authorization = "Bearer $($env:SUPABASE_ACCESS_TOKEN)"; "Content-Type" = "application/json" }
$body = @{ query = "SELECT 1;" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/wlrdwrlxkjgubdmntfxl/database/query" -Method Post -Headers $headers -Body $body
```

Note: only single SQL statements per request reliably work (multi-statement with `;` can error).

### Current Schema (public schema)
All tables have RLS enabled. App uses the anon/publishable key only — no service role in the browser.

- **`app_state`**: `key (text, PK-ish)`, `data (jsonb)`, `updated_at`. Generic localStorage-mirror blob sync (`SyncContext.jsx`). RLS: anon SELECT/INSERT/UPDATE, `qual: true` (fully open).
- **`exercises`**: `id (uuid)`, `name`, `primary_muscle`, `secondary_muscles (array)`, `primary_sub_muscles (text[])`, `secondary_sub_muscles (text[])`, `created_at`. Exercise → muscle lookup (`muscleUtils.js`); sub-muscles power the body map (see Muscle Map). RLS: public read (`true`), insert/update open (`true`).
- **`health_metrics`**: `id`, `user_id`, `date`, `sleep_score`, `sleep_stages (jsonb)`, `hrv`, `resting_hr`, `steps`, `active_minutes`, `raw_fitbit_data (jsonb)`, `created_at`. Google Fit daily sync (`googleFitSync.js`), unique on `(user_id, date)`. RLS: anon ALL where `user_id = 'dane'`.
- **`user_integrations`**: `id`, `user_id`, `provider`, `access_token`, `refresh_token`, `expires_at`, `scopes`. Cross-device OAuth token storage (currently used by Google Fit, `provider='googlefit'`), unique on `(user_id, provider)`. RLS: anon ALL, `qual: true` (fully open).
- **`user_context`**: `id (uuid)`, `user_id`, `goals (text)`, `created_at`. RLS enabled but **no policies defined** — currently inaccessible to anon key (not actively used by the app yet).

## Stack
- Vite + React 18, React Router v6
- Single CSS file: `src/styles/globals.css` (~2000+ lines, no CSS modules)
- Dark theme: `#050506` bg, `#E8A020` warm amber (`--accent`), `#6BE3A4` success green (`--success`), `#F2C063` secondary amber (`--warning`)
- Fonts: `var(--font-body)` (Geist Sans), `var(--font-display)` (Plus Jakarta Sans), `var(--font-mono)` (Geist Mono)

## Data Layer
- **localStorage** is primary — `storeGet`/`storeSet` from `src/lib/storage.js`
- **Supabase** blob sync via `src/contexts/SyncContext.jsx` (`app_state` table, keyed by `key`)
- Active date: `getActiveDateString()` from `src/lib/dateHelpers.js`
- Cross-module events: `window.dispatchEvent(new Event('gym-changed'))`, `'goals-changed'`, `'schedule-sync'`, `'sync-applied'`
- **`storeSet` vs `storeSetSilent` — CRITICAL for sync correctness.** `storeSet` stamps `_lastLocalChange` (= "the user just edited") and schedules a push. Automated/startup writes (migrations, rollovers, back-fills) must use `storeSetSilent` instead — it writes without the stamp. A startup `storeSet` during the async pull window makes a fresh reload look like it holds newer edits than the server, which skips the remote pull and overwrites good cross-device data with stale local data. The initial pull is resolved against a boot-time snapshot of `_lastLocalChange`, and `SyncContext` also re-pulls on tab focus/visibility (realtime sockets die while backgrounded).

## Cross-Device Sync — REQUIRED FOR ALL FEATURES
**Every new feature that persists data must be wired into Supabase sync.** localStorage alone does not sync across devices.

### How to add a new key to sync:
1. **Static key** (fixed name like `'my_feature_data'`): add it to `STATIC_SYNC_KEYS` in `src/contexts/SyncContext.jsx`.
2. **Dynamic keys** (one per date/week, e.g. `'my_feature:2026-06-17'`): add the prefix to `DYNAMIC_SYNC_PREFIXES` in `src/contexts/SyncContext.jsx`.
3. **Component refresh**: after remote sync, `sync-applied` is dispatched. Add a `useEffect` listener in the component that re-reads from localStorage via `storeGet` and calls the relevant `setState`. See `HabitsSection.jsx` or `GoalsProjectsSection.jsx` for the pattern.

### Currently synced keys:
- `goals:*` (all date-keyed task lists), `goal_streak_v1`, `goals_projects`, `general_tasks`, `recurring_tasks`
- `habits`, `habits_log:*` (weekly completion logs)
- `gym_templates`, `gym_planned`, `gym_week_tpls`, `gym_workout_logs`, `gym_exercise_history`, `custom_exercises`, `gym_settings`
- `calendar_events`, `journal_entries`
- `layouts_v1`, `nav_order_v1` (card-grid layouts + nav order — see Dynamic Card System)

### Events dispatched after remote sync applies:
- `goals-changed` — Todo, Goals, Dashboard ticker
- `gym-changed` — Gym module
- `sync-applied` — HabitsSection, GoalsProjectsSection, every dc- card grid, UIEditContext, useNavModules (and any new component added per the pattern above)

## Dynamic Card System (dc-)
Apple-widgets-style rearrangeable card grid: sizes S/M/L/XL, iOS-style edit mode (drag + resize on mobile **and** desktop), Manual/Auto layout modes. Adopted by **Dashboard, Health (both faces), Goals face, Journal Reflect**. **Gym, Calendar, Journal Write, and Todo Tasks are exempt by design** (bespoke drag systems / single-purpose layouts). All new classes are `dc-` (grid/cards) or `setnav-` (nav settings UI) prefixed. No new deps — hand-rolled.

### Engine files
- `src/hooks/useViewport.js` — ResizeObserver on the **grid container** (not window) → `{cols:2|3|4, bp, rowUnit, vhTier}`, debounced 150ms. cols by container width (<560→2, <980→3, else 4); rowUnit 132/142/150px; vhTier short/normal/tall by window height. Grid-scoped — do NOT retrofit modules' frozen matchMedia constants.
- `src/lib/cards/layoutStore.js` — load/sanitize/save `layouts_v1`; `SIZE_ORDER`, `clampSize`, `bpBucket(cols)` (2→`mobile`, 3|4→`desktop`), `buildDefaultLayout`, `sanitizeLayout`. Every `storeSet` path (`saveAreaLayout`, `setLayoutMode`) is **USER-GESTURE-ONLY**.
- `src/lib/cards/autoLayout.js` — pure `computeAutoLayout(registry, visibleIds, cols, vhTier) → {order, sizes}`. Deterministic (no Date/random/DOM): per-widget `autoSize[cols]` → vhTier demote(short)/promote-top-2(tall) → priority shelf-pack with bounded lookahead + lonely-S tail polish. Result is in-memory only, **NEVER persisted**.
- `src/contexts/UIEditContext.jsx` — `UIEditProvider` (mounted in App.jsx under SyncProvider) + `useUIEdit()` → `{editing, startEditing, stopEditing, layoutMode, setLayoutMode}`. `editing` = plain React state, never persisted/synced, survives route changes, auto-exits on Escape + tab-hidden; sets `body.dc-editing` + `window.__uiEditing`. `layoutMode` mirrors `layouts_v1.mode`; re-reads on `sync-applied`.
- `src/components/cards/` — `CardGrid.jsx` (renderer + orchestration), `CardShell.jsx` (per-card chrome: `.dc-item` > `.dc-jiggle` > `.dc-content`; hide − / size badge render as siblings so the widget never remounts on enter/exit edit), `WidgetTray.jsx` (hidden-widget re-add chips), `useCardDrag.js` (pointer/touch drag), `useFlipReflow.js` (FLIP glide on order/size/cols change).

### `layouts_v1` schema (STATIC_SYNC_KEY)
```js
{ v:1, mode:'manual'|'auto',
  <area>: { mobile:{order:[], sizes:{id:size}, hidden:[]}, desktop:{…} } }
```
Areas today: `dashboard`, `health_overview`, `health_trends`, `goals`, `journal_reflect`. Per-breakpoint buckets (mobile = 2-col; desktop = 3/4-col) so phone edits never scramble desktop through sync. Rules:
- **Absent area/bucket → in-memory defaults (`buildDefaultLayout`), NEVER written at boot.** First write is the first user edit only.
- `storeSet` fires **once per completed gesture** — one write per drop / size-cycle / hide / show / mode-flip. Never per drag frame.
- **Auto-mode arrangements are computed in memory and NEVER persisted** — only `mode` syncs. Edit-mode "Customize" (adopt-auto) copies the computed arrangement into the manual bucket, then flips `mode → manual` (a gesture).
- `sanitizeLayout` is tolerant: drops unknown ids, clamps sizes to each widget's allowed list, **appends never-seen registry ids visible at the end at defaultSize** (no migration needed); malformed input → full defaults. CardGrid reloads the bucket on breakpoint flip and on `sync-applied` (deferred if a drag is mid-flight).

### `nav_order_v1` + nav customization (STATIC_SYNC_KEY)
`{ order:[paths], hidden:[paths] }` — one shared order for sidebar + bottom tabs + swipe. `src/lib/navOrder.js`: `resolveNavOrder(stored, modules)` (pure, tolerant, **never writes** — drops unknown paths, appends missing, `/` unhideable, ≥2 visible on mobile), `saveNavOrder` (storeSet + `nav-changed`), `useNavModules()` → `{ ordered (sidebar — all modules), mobileVisible (tabs+swipe — minus hidden) }`, re-resolves on `nav-changed` + `sync-applied`. Routes in App.jsx never change (hidden modules stay routable). **Settings applies nav + layout mode on Save**, while the modal still covers the bar — the nav never shifts under the user's thumb.

### Edit mode
- Entered **ONLY** via Settings → **Edit Layout** (`handleEditLayout`: save() → force mode `manual` → `startEditing()` → close modal). **No long-press, by user mandate.** Global — one `editing` flag across all pages.
- **Done pill** (`.dc-done-pill`, rendered by Layout.jsx below BottomNav) → `stopEditing()`. Also exits on Esc / tab-hidden. Never persisted or synced.
- `window.dispatchEvent(new Event('dc-toggle-edit'))` toggles a **dev/test** editing override (OR-ed with context) inside each card page — the hook for entering edit before/without the Settings UI.
- `window.__swipeDisabled = true` **only during an active drag** (restored on drop/cancel) so swipe-nav stays usable between drags while editing.
- **Module-internal drags/interactions are suspended in edit mode** via `useUIEdit()` early-return guards (Todo GoalList, Calendar TimeGrid, Gym PlannerView, Calendar AIPlannerPanel). RestTimer/modals live outside card wrappers and stay viewport-fixed.

### Adding a dashboard widget
1. Write `src/modules/dashboard/widgets/MyWidget.jsx` — a `component({ size, bp })` that is self-contained (own `storeGet` + `sync-applied` listener) and renders meaningfully at **every** declared size.
2. Add a registry entry in `widgets/registry.jsx`: `{ title, icon, component, sizes:['S','M','L'], defaultSize:'M', chromeless?, autoPriority, autoSize:{2,3,4} }`. `sanitizeLayout` auto-appends the new id to existing stored layouts; add it to `DEFAULT_DASH_ORDER` to control seed position.

### Module adoption patterns
Each adopting page renders `<CardGrid area registry defaultOrder editing mode onAdoptAuto/>` (editing/mode from `useUIEdit()`, plus the `dc-toggle-edit` dev override). Two registry styles:
- **Static registry** (Goals — `goalsCardRegistry.jsx`): widgets are self-contained (own reads/listeners/writes). Module-level const → stable identity.
- **ctxRef builder** (Health — `healthCardRegistries.jsx`; Journal — `journalReflectRegistry.jsx`): widgets close over a `ctxRef` owned by the page (shared state / handlers / fetched data). `build…Registry(ctxRef)` runs **once per mount** (`useMemo []`) so identities stay stable — data changes re-RENDER (read `ctxRef.current`) but never REMOUNT (charts don't replay animations).
- `chromeless:true` skips the `.dc-card` frame when content already renders its own glass surface (all Goals/Journal cards; some Dashboard).

### CSS conventions
- One bounded block appended at the **END** of `globals.css` per adopting area (`dc-goals-`, `dc-journal-` … with `END` marker comments). No generic names, no bare element selectors.
- `.dc-grid`: `grid-template-columns: repeat(var(--dc-cols), minmax(0,1fr))`, `grid-auto-rows: var(--dc-row)`, `grid-auto-flow: row dense`, gap 14px. Spans: S=1×1, M=2×1, L=2×2, XL=full×2 (mobile XL=2×3). Every `.dc-item` gets `min-width/height:0` (recharts grid-blowout guard).
- `body:has(.dc-grid) #root { width:100% }` — `minmax(0,1fr)` columns offer no intrinsic width, so `#root` must fill or the grid collapses.
- **Card wrappers carry NO transform/filter/backdrop-filter at rest** — they'd become containing blocks for the ~15 in-tree `position:fixed` overlays (RestTimer, modals) inside widget content. Transforms live only in edit mode (jiggle, where content is inert) or on inner chrome layers.

## Anthropic API
AI calls are made directly from the browser (no proxy) across multiple modules. API key stored in `localStorage` as `anthropic_api_key`, entered via Settings modal in `src/components/Layout.jsx`.

## Desktop Layout Pattern
- Breakpoint: `window.matchMedia('(min-width: 1024px)').matches` — computed once at module scope (not reactive)
- CSS: `@media (min-width: 1024px)` blocks in `globals.css`
- `page-wrap` max-width: 1440px, centered
- Sidebar width: `var(--sidebar-w)` (220px on desktop)

## Directory Structure
```
src/
  App.jsx                    # Route definitions + modules array (used by nav)
  main.jsx                   # Entry point: doRollover + injectRecurringTasks on startup
  components/
    Layout.jsx               # Shell: sidebar + bottom nav + settings modal (Customize/nav) + sync status + Done pill
    Sidebar.jsx              # Desktop sidebar nav (useNavModules → ordered)
    BottomNav.jsx            # Mobile bottom tab bar (useNavModules → mobileVisible)
    BackgroundBlob.jsx       # Animated per-page blob background
    FlipSwitch.jsx           # Shared view-switch control: useFlip + FlipTitle
    cards/                   # Dynamic Card System engine (see "Dynamic Card System")
      CardGrid.jsx           # Grid renderer + drag/auto/sync orchestration
      CardShell.jsx          # Per-card chrome (.dc-item > .dc-jiggle > .dc-content; hide/size badge)
      WidgetTray.jsx         # Hidden-widget re-add chips
      useCardDrag.js         # Pointer/touch drag engine
      useFlipReflow.js       # FLIP glide on order/size/cols change
  contexts/
    SyncContext.jsx          # Supabase sync provider (debounced)
    UIEditContext.jsx        # Global card-edit state (editing/layoutMode) — never persisted
  hooks/
    useViewport.js           # Container-measured grid tiers {cols, bp, rowUnit, vhTier}
  lib/
    storage.js               # storeGet / storeSet / storeDelete / storeListKeys
    dateHelpers.js           # getActiveDateString (rolls at 5 AM), getTomorrowDateString, formatDate
    init.js                  # doRollover / injectRecurringTasks
    supabase.js              # Supabase client init
    navOrder.js              # resolveNavOrder / saveNavOrder / useNavModules (nav_order_v1)
    cards/
      layoutStore.js         # load/sanitize/save layouts_v1; clampSize, bpBucket
      autoLayout.js          # pure computeAutoLayout (in-memory, never persisted)
    muscleUtils.js           # Exercise → primary_muscle lookup (Supabase exercises table)
    muscleMigration.js       # Back-fills primary_muscle on existing logs/templates
    api/
      anthropic.js           # getAnthropicKey / setAnthropicKey
      gcalendar.js           # GCal OAuth token storage + connection status
      googlefit.js           # Google Fit token storage (shares GCal credentials)
      fitbit.js              # Fitbit token storage (not actively integrated)
      notion.js              # Notion API key storage (not actively integrated)
  styles/
    globals.css              # ALL CSS (single file)
  modules/
    dashboard/
      index.jsx              # Re-exports DashboardCards
      DashboardCards.jsx     # Card-grid dashboard: blob + GoalTicker strip + CardGrid (area 'dashboard')
      widgets/
        registry.jsx         # DASH_WIDGETS (10) + DEFAULT_DASH_ORDER
        GoalTickerStrip.jsx  # Fixed ticker strip above the grid (NOT a registry widget)
        *Widget.jsx          # DayRing/Schedule/Queue/Pulse/Overseer + GymNext/Sleep/HabitsWeek/Journal/Streak
    goals/                   # /goals route — Goals ⇄ Tasks flip (FlipTitle)
      Goals.jsx              # Shell: Goals face = CardGrid (area 'goals'); Tasks face = <Todo embedded>
      goalsCardRegistry.jsx  # GOALS_REGISTRY (insights/habits/projects) — static self-contained widgets
      components/AIInsightsCard.jsx  # AI "how you're doing" read
      HabitsSection.jsx      # Habits 7×N grid; re-reads on 'sync-applied'
      GoalsProjectsSection.jsx       # Long-term goals + milestones
    todo/
      Todo.jsx               # Tasks face (embedded in Goals): today/tomorrow goals, recurring tasks
                             # Queue: goal.queued=true marks high-priority (⚡); internal drag guarded via useUIEdit
    overseer/
      index.jsx              # /overseer — full-page AI chat (Dashboard Overseer widget links here)
    gym/
      Gym.jsx                # Shell: mobile 6-tab / desktop 3-col layout + rest timer
      gymUtils.js            # gymUUID, calcE1RM, parseRepRange, DSHORT, DFULL, MONTHS, dateToStr
      components/
        TemplatesView.jsx    # Workout templates CRUD — collapsible cards (collapsed by default)
        PlannerView.jsx      # Weekly planner grid + week templates (collapsible section)
                             # desktopMode prop: shows exercise list inside day cells
        AICoachView.jsx      # Anthropic API → populates planner
        LogView.jsx          # Active workout logger (mobile primary)
        HistoryView.jsx      # Past workout sessions (expandable)
        RestTimer.jsx        # Rest timer overlay
        StatsView.jsx        # Exercise stats + search bar; renders MuscleMapSection on top
        MuscleMapSection.jsx # "Muscles Worked This Week" — body heatmap + 6-axis radar, Sets/Volume toggle
        BodySVG.jsx          # Front+back body map via react-body-highlighter (amber gradient by intensity)
        ExercisesView.jsx    # Browse/search exercises + add custom (AI fills sub-muscles)
    calendar/
      Calendar.jsx           # Shell: day (default) / week / month views
      TimeGrid.jsx           # Hour-by-hour grid for day/week
      MonthView.jsx          # Month grid
      MiniMonth.jsx          # Mini calendar overlay inside TimeGrid
      EventModal.jsx         # Create/edit event form
      EventSidebar.jsx       # Event list sidebar
      AIPlannerPanel.jsx     # AI-powered day/week planning panel
      DayReviewPanel.jsx     # Daily review panel
      calendarUtils.js       # getDayEvents, getWeekDays, gymPlannedToEvent, etc.
                             # getDayEvents merges calendar_events + gym_planned for a day
      googleSync.js          # GCal OAuth flow + sync functions
    journal/
      Journal.jsx            # Daily entries, AI analysis, tags, rotating prompts, 24h lock
      journalUtils.js        # Entry dating, prompts, streak calc, AI model list
    health/
      Health.jsx             # Google Fit data display: sleep, HR, HRV, activity
      HealthCharts.jsx       # Recharts components (SleepTrend, HRVTrend, RestingHR,
                             # SleepStages, WeeklyActivity)
      googleFitSync.js       # Google Fit OAuth + data fetching
      fitbitSync.js          # Fitbit sync (exists, unused)
```

## Key Data Shapes
- **Goal/To-Do**: `{ id, text, done, queued?, date }` — stored at `goals:YYYY-MM-DD`
- **Gym planned**: `{ id, date, name, templateId, exercises[], status }` — stored at `gym_planned`
- **Gym template**: `{ id, name, exercises[{name, sets, repRange, notes, primary_muscle?}] }` — stored at `gym_templates`
- **Gym log**: `{ id, date, exercises[{name, primary_muscle, sets[{weight, reps, rpe, e1rm, allHitTop}]}] }` — stored at `gym_workout_logs`
- **Gym history**: keyed by exercise name, `{ allTimePR, sessions[{date, weight, reps, rpe, e1rm, allHitTop}] }` — stored at `gym_exercise_history`
- **Calendar event**: `{ id, title, start_time, end_time, is_all_day, color?, user_id, created_at, module_tag? }`
- **Journal entry**: `{ id, date, created_at, content, tags[], analysis?, model_used?, analysis_time? }` — stored at `journal_entries`
- **Recurring task**: `{ text, freq: 'daily'|'weekly'|'monthly', days[] }` — stored at `recurring_tasks`

## Gym Desktop Layout (3-col)
```
| Templates (240px) | Planner (1fr) | Panel (320px) |
                                     AI Coach / History / Stats
```
Templates: collapsed cards, click to expand.
Planner: `desktopMode` prop shows exercises inside day cells; Week Templates section is collapsible.
Panel: tab-switched between AI Coach, History, Stats.

## Muscle Map (Stats tab)
`MuscleMapSection.jsx` shows muscles worked **this week** (Sun–Sat) as an amber body heatmap (`react-body-highlighter`, front + back) plus a 6-axis radar (Arms / Back / Legs / Chest / Shoulders / Core). A Sets/Volume toggle drives both. Big `%` = share of the 19 sub-muscles touched.
- **Sub-muscle taxonomy** lives in `src/lib/subMuscleData.js`: `ALL_SUB_MUSCLES` (19), `RADAR_GROUPS` (axis → sub-muscles), `SUB_TO_LIB_MUSCLE` (our names → library's coarser set), `DEFAULT_SUB_MUSCLES` (fallback by `primary_muscle`), `SUB_MUSCLE_AI_PROMPT`.
- Each exercise's `primary_sub_muscles`/`secondary_sub_muscles` come from the `exercises` table (fetched + cached in `MuscleMapSection`). Custom exercises get sub-muscles from a background Anthropic (Haiku) call in `addCustomExercise` (`muscleUtils.js`), stored on the `custom_exercises` entry.
- Intensity = primary value + 0.4 × secondary value, bucketed 1–5 into the amber gradient.

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
- Health: top-right (35%), multi-color gradient (purple + amber)

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

## Design System — UI Standards

### Button Hierarchy
Always use exactly one of three button classes. Never create one-off button styles.

- `.btn-primary` — amber fill. One per screen max. The dominant action.
- `.btn-secondary` — dark fill, white text, subtle border. Supporting actions and inactive toggle states.
- `.btn-ghost` — transparent, low-emphasis. AI features, cancel, nav links.

Active toggle state = btn-primary. Inactive toggle state = btn-secondary.

### Page Subtitles
All page-level subtitles use `.page-subtitle`: uppercase, letter-spacing 0.12em, 0.7rem, rgba(255,255,255,0.4), not italic, not bold. Never use sentence-case or italic for page-level descriptors.

### View Switching (Flip Pattern)
All in-module view switches use ONE shared, congruent pattern — the "tap-the-title-and-it-flips" control from `src/components/FlipSwitch.jsx`:
- `useFlip(initial)` → `{ flipped, animState, isFlipping, flip }`. Wrap the swapping content in `<div className={`flip-content ${animState}`}>` and pick the face from `flipped`.
- `<FlipTitle icon label isFlipping onClick title />` — an understated, section-label-styled tappable control with a leading contextual icon (swaps per side) + trailing swap-arrows hint. It deliberately does NOT look like a button.
- CSS: the "UNIVERSAL FLIP SWITCH" block in `globals.css` (`.flip-title-btn`, `.flip-content`, `flip-exit`/`flip-enter` keyframes).
- Used by: Goals (Goals⇄Tasks), Health (Overview⇄Trends), Journal (Write⇄Reflect). Gym (Gym⇄Stats) keeps its 3D card-flip transition but uses the same `FlipTitle` control. Do NOT add one-off toggle buttons for view switching — use `FlipTitle`.

### Adding New Modules
Any new module must use only btn-primary / btn-secondary / btn-ghost for all interactive controls, and .page-subtitle for any page-level descriptor. No new button styles may be introduced without updating this section first. Any module-level view switch must use the shared FlipSwitch (`FlipTitle` + `useFlip`).