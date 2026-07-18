import { storeGet, storeSet } from '../storage.js'

// Persisted card-layout blob (synced via STATIC_SYNC_KEYS):
// { v: 1, mode: 'manual'|'auto',
//   <area>: { mobile: {order:[], sizes:{}, hidden:[]}, desktop: {…} } }
// Per-breakpoint buckets so phone edits never scramble desktop through sync.
// CRITICAL: absent key → in-memory defaults, NEVER written at load/boot.
// storeSet here is reserved for USER GESTURES ONLY — callers guarantee this.
export const LAYOUTS_KEY = 'layouts_v1'

export const SIZE_ORDER = ['S', 'M', 'L', 'XL']

// cols 2 → 'mobile' bucket; cols 3|4 → 'desktop' bucket.
export function bpBucket(cols) {
  return cols === 2 ? 'mobile' : 'desktop'
}

// Effective-size clamp for rendering/persistence. `cols` is accepted for API
// stability but triggers no conversion: at 2 cols XL→L is geometric (both span
// the full width; XL just gets an extra row via CSS), so stored sizes stand.
export function clampSize(size, allowed, cols) { // eslint-disable-line no-unused-vars
  const list = Array.isArray(allowed) && allowed.length ? allowed : SIZE_ORDER
  if (list.includes(size)) return size
  const idx = SIZE_ORDER.indexOf(size)
  if (idx === -1) return list[0]
  // nearest allowed size, preferring smaller
  for (let i = idx - 1; i >= 0; i--) {
    if (list.includes(SIZE_ORDER[i])) return SIZE_ORDER[i]
  }
  for (let i = idx + 1; i < SIZE_ORDER.length; i++) {
    if (list.includes(SIZE_ORDER[i])) return SIZE_ORDER[i]
  }
  return list[0]
}

export function buildDefaultLayout(registry, defaultOrder) {
  const known = Object.keys(registry || {})
  const seed = Array.isArray(defaultOrder) && defaultOrder.length ? defaultOrder : known
  const order = seed.filter(id => registry[id])
  known.forEach(id => { if (!order.includes(id)) order.push(id) })
  const sizes = {}
  order.forEach(id => { sizes[id] = clampSize(registry[id].defaultSize, registry[id].sizes) })
  return { order, sizes, hidden: [] }
}

// Tolerant sanitizer: drop unknown ids, dedupe, clamp sizes to each widget's
// allowed list, append never-seen registry ids visible at the end at defaultSize.
// Malformed input → full defaults. Unknown fields are ignored.
export function sanitizeLayout(raw, registry, defaultOrder) {
  const defaults = buildDefaultLayout(registry, defaultOrder)
  if (!raw || typeof raw !== 'object') return defaults

  const seen = new Set()
  const order = (Array.isArray(raw.order) ? raw.order : [])
    .filter(id => typeof id === 'string' && registry[id] && !seen.has(id) && seen.add(id))
  const hidden = (Array.isArray(raw.hidden) ? raw.hidden : [])
    .filter(id => typeof id === 'string' && registry[id] && !seen.has(id) && seen.add(id))

  // Never-seen registry ids: visible, at the end, defaultSize.
  defaults.order.forEach(id => { if (!seen.has(id)) order.push(id) })

  const rawSizes = (raw.sizes && typeof raw.sizes === 'object') ? raw.sizes : {}
  const sizes = {}
  order.concat(hidden).forEach(id => {
    const entry = registry[id]
    sizes[id] = clampSize(
      SIZE_ORDER.includes(rawSizes[id]) ? rawSizes[id] : entry.defaultSize,
      entry.sizes
    )
  })

  return { order, sizes, hidden }
}

function readBlob() {
  const blob = storeGet(LAYOUTS_KEY)
  return (blob && typeof blob === 'object') ? blob : null
}

export function getLayoutMode() {
  const blob = readBlob()
  return blob && blob.mode === 'auto' ? 'auto' : 'manual'
}

// USER GESTURE ONLY (Settings segmented control / adopt-auto).
export function setLayoutMode(mode) {
  const blob = readBlob() || {}
  storeSet(LAYOUTS_KEY, { ...blob, v: 1, mode: mode === 'auto' ? 'auto' : 'manual' })
}

// `bp` accepts a bucket name or a viewport bp ('tablet' maps to 'desktop').
// `defaultOrder` is optional; falls back to registry key order.
export function loadLayout(area, registry, bp, defaultOrder) {
  const bucket = bp === 'mobile' ? 'mobile' : 'desktop'
  const blob = readBlob()
  const areaBuckets = blob && blob[area] && typeof blob[area] === 'object' ? blob[area] : null
  return sanitizeLayout(areaBuckets ? areaBuckets[bucket] : null, registry, defaultOrder)
}

// USER GESTURE ONLY — one call per completed gesture (drop, size cycle, hide, show).
// Merges the single area+bucket into the full blob so other areas/buckets survive.
export function saveAreaLayout(area, bpBucketName, layout) {
  const bucket = bpBucketName === 'mobile' ? 'mobile' : 'desktop'
  const blob = readBlob() || {}
  const areaBuckets = (blob[area] && typeof blob[area] === 'object') ? blob[area] : {}
  storeSet(LAYOUTS_KEY, {
    ...blob,
    v: 1,
    mode: blob.mode === 'auto' ? 'auto' : 'manual',
    [area]: {
      ...areaBuckets,
      [bucket]: {
        order: [...layout.order],
        sizes: { ...layout.sizes },
        hidden: [...layout.hidden],
      },
    },
  })
}
