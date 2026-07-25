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
