// Single source of truth for which localStorage keys participate in cross-device sync.
//
// These lists used to be duplicated between SyncContext.jsx and backup.js with a
// "KEEP IN SYNC" comment; the copies had already drifted (backup.js was silently missing
// five keys and the finance: prefix, so backups quietly omitted that data). Both modules
// now import from here. Pure data — no dependencies, safe to import anywhere.
//
// Rule: every key written with `storeSet` by any module must appear below, or be
// deliberately device-local (see DEVICE_LOCAL_KEYS for what that means).

export const STATIC_SYNC_KEYS = [
  // Goals / Tasks
  'goal_streak_v1',
  'goals_projects',
  'general_tasks',
  'recurring_tasks',
  // Habits
  'habits',
  // Gym
  'gym_templates', 'gym_planned', 'gym_week_tpls', 'gym_workout_logs', 'gym_exercise_history', 'custom_exercises', 'gym_settings',
  // Calendar
  'calendar_events',
  // Journal
  'journal_entries',
  // Body metrics (weigh-in log)
  'body_metrics_v1',
  // Weekly review ritual (marks a week reviewed)
  'weekly_reviews_v1',
  // Finances (per-category monthly budgets)
  'finance_budgets',
  // Notifications & reminders (per-type prefs; permission + dedupe marks stay device-local)
  'notif_prefs_v1',
  // Layout customization (card grids + nav order)
  'layouts_v1', 'nav_order_v1',
  // Overseer terminal (context budgets, prompt override, model/mode/skin)
  'overseer_config_v1',
]

// Key prefixes whose instances are enumerated at push time (one key per date/week/month).
export const DYNAMIC_SYNC_PREFIXES = [
  'goals:',             // today's and all future/past task lists
  'habits_log:',        // one key per calendar week
  'daily_focus:',       // today's thematic focus (one per date)
  'journal_synthesis:', // one cached AI synthesis per month
  'finance:',           // one transaction array per month (finance:YYYY-MM)
]

// Sync-layer bookkeeping. Never synced, never backed up, never exported — these describe
// THIS device's view of the data, so importing another device's copy would corrupt
// conflict resolution.
export const SYNC_META_KEYS = [
  '_lastLocalChange', // legacy global edit marker
  '_key_ts_v1',       // per-key last-local-write times
  '_key_tombs_v1',    // deleted keys + deletion time
  '_item_tombs_v1',   // deleted items within a collection key
  '_ord_ts_v1',       // per-key last-reorder times
  '_sync_v2_off',     // kill switch: falls back to the pre-merge sync path
]

export function isSyncedKey(key) {
  if (!key) return false
  if (STATIC_SYNC_KEYS.includes(key)) return true
  return DYNAMIC_SYNC_PREFIXES.some(p => key.startsWith(p))
}

// ---------------------------------------------------------------------------
// COLLECTIONS — keys holding a list of independently-editable records.
//
// These are the keys where "last writer wins the whole key" actually loses work: two
// devices touching two DIFFERENT tasks, events or workouts a second apart. Listing a key
// here lets the sync layer merge it record-by-record instead.
//
//   idField — the field that identifies a record across devices. It must be stable under
//             editing: `text` is not an identity, because renaming a task would read as
//             delete + create and duplicate it.
//   path    — for keys wrapping their list in an envelope (body_metrics_v1 is
//             `{v:1, entries:[…]}`), the property holding the array.
//   ci      — compare ids case-insensitively.
//
// Anything NOT listed here is whole-key last-write-wins, which is correct for settings
// blobs and single-value keys — see the classification note on each.
// ---------------------------------------------------------------------------
//   ordered — the array's order is a user decision (drag-to-reorder), so it has to
//             survive merging. These keys carry a per-record rank; everything else keeps
//             whatever order it is given, because its views sort by date anyway.
export const COLLECTIONS = {
  'goals:':           { idField: 'id', ordered: true },  // prefix — one list per date
  'finance:':         { idField: 'id' },                 // prefix — one list per month
  general_tasks:      { idField: 'id', ordered: true },
  goals_projects:     { idField: 'id' },  // nested milestones/checkpoints merge with their goal
  habits:             { idField: 'id' },
  gym_workout_logs:   { idField: 'id' },
  gym_templates:      { idField: 'id' },
  gym_week_tpls:      { idField: 'id' },
  calendar_events:    { idField: 'id' },
  journal_entries:    { idField: 'id' },
  // Planner days are identified by the DAY, not a row id: applying a week template mints
  // fresh ids for the same dates, so merging by id would show two plans for one day.
  gym_planned:        { idField: 'date' },
  // Custom exercises have never carried an id; name is the identity the rest of the app
  // already uses to look them up.
  custom_exercises:   { idField: 'name', ci: true },
  body_metrics_v1:    { idField: 'date', path: 'entries' },
}

// ---------------------------------------------------------------------------
// MAPS — keys holding an object whose top-level entries are independently owned.
//
// Same problem as COLLECTIONS, different shape: two devices ticking two different habits
// in the same week write the same key, and whole-key resolution throws one away. Merging
// per entry keeps both.
//
//   depth — how far down entries stay independent.
//   merge — a named special case where the values themselves can be combined.
//
// Two limits, both from the values carrying no times of their own:
//   - An entry ADDED on each device survives on both. An entry that already existed on
//     both and then changed on both still resolves to one of them, by key time.
//   - An entry deleted on one device is restored by the other, because a plain object
//     cannot say "this used to exist". Only keys where that is harmless belong here.
//
// layouts_v1 is deliberately NOT here. Its per-breakpoint buckets always exist on both
// sides, so entry-level merging cannot tell which side actually rearranged — it would
// look like it protected phone-vs-desktop edits without doing so. Whole-key resolution
// is honest: layout changes are one deliberate Settings gesture, and the last save wins.
// ---------------------------------------------------------------------------
export const MAP_MERGES = {
  'habits_log:':        { depth: 1 },  // per habit id, within a week
  weekly_reviews_v1:    { depth: 1 },  // per week; weeks are only ever added
  gym_exercise_history: { merge: 'exerciseHistory' },
}

export function getMapMerge(key) {
  if (!key) return null
  if (Object.prototype.hasOwnProperty.call(MAP_MERGES, key)) return MAP_MERGES[key]
  for (const [k, desc] of Object.entries(MAP_MERGES)) {
    if (k.endsWith(':') && key.startsWith(k)) return desc
  }
  return null
}

// Whole-key last-write-wins, deliberately:
//   goal_streak_v1, daily_focus:*, journal_synthesis:*  — single derived/cached values
//   nav_order_v1, notif_prefs_v1, gym_settings,
//   overseer_config_v1, finance_budgets                 — saved as one Settings gesture,
//                                                         where "the last save wins" is
//                                                         what a user actually expects
//   recurring_tasks                                     — no id field, edited as a unit

export function getCollection(key) {
  if (!key) return null
  if (Object.prototype.hasOwnProperty.call(COLLECTIONS, key)) return COLLECTIONS[key]
  for (const [k, desc] of Object.entries(COLLECTIONS)) {
    if (k.endsWith(':') && key.startsWith(k)) return desc
  }
  return null
}
