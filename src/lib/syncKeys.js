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
  // Which past days have already been carried forward. Must sync, or each device rolls
  // the same day again and re-adds tasks the other device's user already deleted.
  'rollover_done_v1',
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
  '_sync_rows_v1',    // per server row: last updated_at seen + signature of last synced data
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
  rollover_done_v1:     { depth: 1 },  // per retired day; days are only ever added
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
//   overseer_config_v1                                  — saved as one Settings gesture,
//                                                         where "the last save wins" is
//                                                         what a user actually expects
//   recurring_tasks                                     — no id field, edited as a unit

// ---------------------------------------------------------------------------
// ARCHIVE — which keys live in the second server row.
//
// Every sync download moves a whole row, and the main row used to hold every day's task
// list since the app began. Past days, past habit weeks and past AI summaries are
// history: they still sync, but they almost never change. Keeping them in their own row
// (`dane_archive`) means the main row — downloaded on every remote edit — stays small,
// and the archive is downloaded only on the rare occasions it actually changes.
//
// The cutoff snaps back to a Monday so keys move into the archive in weekly batches
// rather than one a day: each move rewrites the archive row, and every other device then
// downloads it once.
//
// Both devices compute the cutoff from their own active date. Around the weekly boundary
// they can briefly disagree about a key; that is harmless, because a key in the "wrong"
// row is still merged normally and neither row's push decision counts the other row's
// keys (see the `scope` option of applyRemote).
// ---------------------------------------------------------------------------
export const ARCHIVE_AFTER_DAYS = 14

const DAY_MS = 86400000
const utcDay = (y, m, d) => Date.UTC(y, m - 1, d)
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)

// 'YYYY-MM-DD' → the Monday on or before (activeDate − ARCHIVE_AFTER_DAYS).
export function archiveCutoff(activeDate) {
  const [y, m, d] = String(activeDate).split('-').map(Number)
  if (!y || !m || !d) return '0000-00-00' // unparseable → archive nothing
  const ms = utcDay(y, m, d) - ARCHIVE_AFTER_DAYS * DAY_MS
  const dow = (new Date(ms).getUTCDay() + 6) % 7 // Monday = 0
  return isoDay(ms - dow * DAY_MS)
}

// The last day a dated key covers, or null for keys that are not dated history.
function periodEnd(key) {
  let m = /^(?:goals|daily_focus):(\d{4}-\d{2}-\d{2})$/.exec(key)
  if (m) return m[1]
  m = /^journal_synthesis:(\d{4})-(\d{2})$/.exec(key)
  if (m) return isoDay(utcDay(+m[1], +m[2] + 1, 1) - DAY_MS) // last day of the month
  m = /^habits_log:(\d{4})-W(\d{2})$/.exec(key)
  if (m) {
    // ISO week: week 1 is the week holding January 4th. Return its Sunday.
    const jan4 = utcDay(+m[1], 1, 4)
    const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS
    return isoDay(week1Monday + ((+m[2] - 1) * 7 + 6) * DAY_MS)
  }
  return null
}

export function isArchivedKey(key, cutoff) {
  if (!key || !cutoff) return false
  const end = periodEnd(key)
  return end !== null && end < cutoff
}

// ---------------------------------------------------------------------------
// SPLIT — collection keys whose RECORDS are divided between the two rows.
//
// `calendar_events` is one key holding every event ever made (~630 events, ~255 KB of
// past ones): three quarters of the main row, re-downloaded on every remote change. Past
// events are history just like past task days, but they live in a single list, so the key
// cannot move rows as a whole. Instead each row carries the part of the list on its side
// of the cutoff, under the same key name. Locally the key stays one complete list, so no
// reader changes. The value is the record's end (or start) time; records without a
// parseable date stay in the main row.
// ---------------------------------------------------------------------------
export const SPLIT_COLLECTIONS = {
  calendar_events: (rec) => rec?.end_time || rec?.start_time,
}

export const isSplitKey = (key) => Object.prototype.hasOwnProperty.call(SPLIT_COLLECTIONS, key)

export function isArchivedRecord(key, rec, cutoff) {
  const when = SPLIT_COLLECTIONS[key]?.(rec)
  const day = typeof when === 'string' ? when.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff
}

export function getCollection(key) {
  if (!key) return null
  if (Object.prototype.hasOwnProperty.call(COLLECTIONS, key)) return COLLECTIONS[key]
  for (const [k, desc] of Object.entries(COLLECTIONS)) {
    if (k.endsWith(':') && key.startsWith(k)) return desc
  }
  return null
}
