// Fresh-read write helpers for task lists.
//
// Every task mutation rewrites the WHOLE list for its key. Building that list from the
// React prop means writing back a snapshot taken at render time — so a task that arrived
// from another device in between is silently deleted, and the deletion is pushed. These
// helpers re-read storage immediately before writing and locate the row by `id`, the same
// pattern QueueWidget.completeTask and AddGoalForm.addGoal already use.
//
// Kept separate from Todo.jsx so the index arithmetic is directly testable.

import { storeGet, storeSet } from '../../lib/storage.js'

// Resolve the acted-on row inside the freshly-read list. Rows have had ids since
// backfillItemIds ran at boot; the text+position fallback covers a row written by an
// older build still running on another device.
export function findRow(fresh, goal, index) {
  if (goal?.id) {
    const i = fresh.findIndex(g => g.id === goal.id)
    if (i >= 0) return i
  }
  if (fresh[index] && fresh[index].text === goal?.text) return index
  return -1
}

// Re-read, locate, transform, write. `fn(list, i)` returns the next array, or null to
// abort. Returns false when the row is gone (deleted on another device) — the caller
// still refreshes, so the row disappears instead of being resurrected.
export function writeFresh(goalKey, goal, index, fn) {
  const fresh = storeGet(goalKey) || []
  const i = findRow(fresh, goal, index)
  if (i < 0) return false
  const next = fn(fresh, i)
  if (next) storeSet(goalKey, next)
  return true
}

// Pure core of reorderFresh: where does `moved` land in `fresh`?
// Anchored on the row the item was dropped ONTO rather than a raw index — a task added
// remotely shifts every index, and a raw index would drop the row in the wrong place
// (or off the end). Returns the reordered array, or null if the row is gone.
export function reorderList(fresh, rendered, fromIdx, toIdx) {
  const moved = rendered[fromIdx]
  const anchor = rendered[toIdx]
  const fi = findRow(fresh, moved, fromIdx)
  if (fi < 0) return null
  const next = [...fresh]
  const [item] = next.splice(fi, 1)
  let ti = anchor?.id ? next.findIndex(g => g.id === anchor.id) : -1
  if (ti < 0) ti = Math.min(toIdx, next.length)
  // Match the original splice semantics: dropping downward lands AFTER the anchor.
  else if (toIdx > fromIdx) ti += 1
  next.splice(ti, 0, item)
  return next
}

export function reorderFresh(goalKey, rendered, fromIdx, toIdx) {
  const next = reorderList(storeGet(goalKey) || [], rendered, fromIdx, toIdx)
  if (next) storeSet(goalKey, next)
}
