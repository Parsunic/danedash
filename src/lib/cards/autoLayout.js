import { clampSize } from './layoutStore.js'

// Pure, deterministic auto-arranger — no Date, no random, no DOM.
// Results are computed in memory per (cols, vhTier, visibleIds) and NEVER persisted.
const LOOKAHEAD = 3
const DEMOTE = { XL: 'L', L: 'M', M: 'S' }
const PROMOTE = { S: 'M', M: 'L', L: 'XL' }

function widthOf(size, cols) {
  if (size === 'S') return 1
  if (size === 'XL') return cols
  return 2 // M and L both span 2 columns
}

function isAllowed(entry, size) {
  return Array.isArray(entry.sizes) && entry.sizes.includes(size)
}

function priorityOf(entry) {
  return typeof entry.autoPriority === 'number' ? entry.autoPriority : 99
}

export function computeAutoLayout(registry, visibleIds, cols, vhTier) {
  const ids = (visibleIds || []).filter(id => registry[id])
  const sizes = {}

  ids.forEach(id => {
    const entry = registry[id]
    const want = (entry.autoSize && entry.autoSize[cols]) || entry.defaultSize
    sizes[id] = clampSize(want, entry.sizes, cols)
  })

  // Height adjustments: short screens demote the big cards (L→M, XL→L) where
  // allowed; tall screens promote the two highest-priority (lowest number)
  // widgets one step where allowed.
  if (vhTier === 'short') {
    ids.forEach(id => {
      const size = sizes[id]
      if ((size === 'L' || size === 'XL') && isAllowed(registry[id], DEMOTE[size])) {
        sizes[id] = DEMOTE[size]
      }
    })
  } else if (vhTier === 'tall') {
    const byPriority = [...ids].sort((a, b) =>
      (priorityOf(registry[a]) - priorityOf(registry[b])) || (ids.indexOf(a) - ids.indexOf(b)))
    byPriority.slice(0, 2).forEach(id => {
      const promoted = PROMOTE[sizes[id]]
      if (promoted && isAllowed(registry[id], promoted)) sizes[id] = promoted
    })
  }

  // Shelf pass: walk priority order tracking free width in the current row.
  // A widget that doesn't fit triggers a bounded lookahead pulling forward one
  // that plugs the gap; else the head shrinks one step if that fits and is
  // allowed; else the row closes (grid-auto-flow dense backfills leftovers).
  const queue = [...ids].sort((a, b) =>
    (priorityOf(registry[a]) - priorityOf(registry[b])) || (ids.indexOf(a) - ids.indexOf(b)))
  const order = []
  let rowFree = cols

  const w = id => Math.min(widthOf(sizes[id], cols), cols)

  while (queue.length) {
    if (rowFree <= 0) rowFree = cols
    if (w(queue[0]) <= rowFree) {
      const id = queue.shift()
      order.push(id)
      rowFree -= w(id)
      continue
    }
    let pulled = -1
    for (let i = 1; i < Math.min(queue.length, 1 + LOOKAHEAD); i++) {
      if (w(queue[i]) <= rowFree) { pulled = i; break }
    }
    if (pulled > 0) {
      const id = queue.splice(pulled, 1)[0]
      order.push(id)
      rowFree -= w(id)
      continue
    }
    const head = queue[0]
    const demoted = DEMOTE[sizes[head]]
    if (demoted && isAllowed(registry[head], demoted) && widthOf(demoted, cols) <= rowFree) {
      sizes[head] = demoted
      order.push(queue.shift())
      rowFree -= widthOf(demoted, cols)
      continue
    }
    rowFree = cols // close the row
  }

  // Tail polish: a lone S stranded on the final row reads as an orphan → M if allowed.
  const rows = []
  let current = []
  let free = cols
  order.forEach(id => {
    const wd = w(id)
    if (wd > free) { rows.push(current); current = []; free = cols }
    current.push(id)
    free -= wd
    if (free <= 0) { rows.push(current); current = []; free = cols }
  })
  if (current.length) rows.push(current)
  const last = rows[rows.length - 1]
  if (last && last.length === 1 && sizes[last[0]] === 'S' && isAllowed(registry[last[0]], 'M')) {
    sizes[last[0]] = 'M'
  }

  return { order, sizes }
}
