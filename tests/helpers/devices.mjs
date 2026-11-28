// Simulated devices for the sync protocol tests.
//
// Each device has its own localStorage and runs either the CURRENT engine
// (src/lib/syncEngine.js) or the LEGACY protocol — the SyncContext of the production build
// before the egress rework, driven by the frozen modules in tests/fixtures/legacy-sync.
import assert from 'node:assert/strict'
import { als, MemoryStorage } from './env.mjs'
import { newStats } from './fakeSupabase.mjs'

const { storeSet } = await import('../../src/lib/storage.js')
const { createSyncEngine } = await import('../../src/lib/syncEngine.js')
const { STATIC_SYNC_KEYS, DYNAMIC_SYNC_PREFIXES } = await import('../../src/lib/syncKeys.js')
const { comparable } = await import('../../src/lib/syncMerge.js')
export const legacy = {
  storage: await import('../fixtures/legacy-sync/storage.js'),
  meta: await import('../fixtures/legacy-sync/syncMeta.js'),
  merge: await import('../fixtures/legacy-sync/syncMerge.js'),
  keys: await import('../fixtures/legacy-sync/syncKeys.js'),
}
export { storeSet }

export const FAST = {
  pushDebounceMs: 40, pushMaxWaitMs: 150, retryMs: 400, pollMs: 600, focusMinGapMs: 50,
  signalDebounceMs: 30, breakerWindowMs: 5000, breakerMax: 6,
}

const toMs = (ts) => (ts ? new Date(ts).getTime() : 0)
const clone = (v) => JSON.parse(JSON.stringify(v))

export function makeDevice(name, { date = '2026-11-21' } = {}) {
  return {
    name, date, visible: true, stats: newStats(), warns: [], notifies: 0, status: null,
    ctx: { ls: new MemoryStorage(), name, onEvent: null },
  }
}

export const inDevice = (dev, fn) => als.run(dev.ctx, fn)

export function startCurrent(dev, supa) {
  return inDevice(dev, () => {
    dev.engine = createSyncEngine({
      client: supa.clientFor(dev),
      notify: () => { dev.notifies++ },
      onStatus: (s) => { dev.status = s },
      isVisible: () => dev.visible,
      getActiveDate: () => dev.date,
      timing: FAST,
      log: { warn: (...a) => dev.warns.push(a.map(String).join(' ')) },
    })
    dev.ctx.onEvent = (t) => { if (t === 'schedule-sync') dev.engine.schedulePush('edit') }
    return dev.engine.start()
  })
}

export function stopDevice(dev) {
  inDevice(dev, () => { dev.engine?.stop(); dev.stopLegacy?.() })
  dev.ctx.onEvent = null
}

// The payload the legacy build pushed: every key it synced, plus unscoped metadata.
export function legacyPayload() {
  const p = {}
  legacy.keys.STATIC_SYNC_KEYS.forEach(k => {
    const v = localStorage.getItem(k)
    if (v !== null) p[k] = JSON.parse(v)
  })
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (legacy.keys.DYNAMIC_SYNC_PREFIXES.some(x => k.startsWith(x))) p[k] = JSON.parse(localStorage.getItem(k))
  }
  p.__meta_v2 = legacy.meta.buildSyncMeta()
  return p
}

// The legacy SyncContext: full-row read before every push, postgres_changes fan-out.
export function startLegacy(dev, supa) {
  return inDevice(dev, async () => {
    const client = supa.clientFor(dev)
    let lastPushed = 0, syncing = false, timer = null, init = false, stopped = false
    dev.legacyPushes = 0
    const apply = (data, ms) => {
      syncing = true
      try { return legacy.merge.applyRemote(data, ms).needsPush } finally { syncing = false }
    }
    async function push(attempt = 0) {
      if (syncing || stopped) return
      const { data: row, error } = await client.from('app_state').select('data, updated_at').eq('key', 'dane').single()
      if (error) return
      const priorIso = new Date(row.updated_at).toISOString()
      if (row.data && toMs(row.updated_at) !== lastPushed) apply(row.data, toMs(row.updated_at))
      const nextIso = new Date(Math.max(Date.now(), Date.parse(priorIso) + 1)).toISOString()
      lastPushed = toMs(nextIso)
      const { data: upd } = await client.from('app_state').update({ data: legacyPayload(), updated_at: nextIso })
        .eq('key', 'dane').eq('updated_at', priorIso).select('updated_at')
      if (!upd?.length) { if (attempt < 2) return push(attempt + 1); return }
      dev.legacyPushes++
    }
    const schedule = () => {
      if (syncing || !init || stopped) return
      clearTimeout(timer)
      timer = setTimeout(() => push(), FAST.pushDebounceMs)
    }
    dev.ctx.onEvent = (t) => { if (t === 'schedule-sync') schedule() }
    const { data: row } = await client.from('app_state').select('data, updated_at').eq('key', 'dane').single()
    const needsPush = row?.data ? apply(row.data, toMs(row.updated_at)) : false
    init = true
    if (needsPush) schedule()
    const ch = client.channel('dashboard-sync').on('postgres_changes', {}, (change) => {
      if (stopped || !change.new?.data || change.new.key !== 'dane') return
      const ms = toMs(change.new.updated_at)
      if (ms === lastPushed) return
      if (apply(change.new.data, ms)) schedule()
    }).subscribe()
    dev.stopLegacy = () => { stopped = true; clearTimeout(timer); ch.unsubscribe() }
  })
}

// ── synthetic data, shaped like the real app's ──────────────────────────────────────
export const TODAY = '2026-11-21'
export const dayStr = (base, delta) =>
  new Date(Date.parse(base + 'T00:00:00Z') + delta * 86400000).toISOString().slice(0, 10)
let seq = 0
export const uid = (p) => `${p}-${(++seq).toString(36)}-${'x'.repeat(28)}`

export function seedData() {
  for (let d = -90; d <= 1; d++) {
    const date = dayStr(TODAY, d)
    storeSet(`goals:${date}`, Array.from({ length: 6 }, (_, i) => ({
      id: uid('t'), text: `Task ${i} on ${date}`, done: d < 0 && i % 2 === 0, date,
    })))
  }
  for (let w = 30; w <= 47; w++) {
    storeSet(`habits_log:2026-W${String(w).padStart(2, '0')}`, { h1: [1, 0, 1, 1, 0, 1, 0], h2: [0, 1, 1, 0, 1, 1, 1] })
  }
  storeSet('habits', [{ id: 'h1', name: 'Read' }, { id: 'h2', name: 'Stretch' }])
  // ~4 events a day over the last 120 days, plus a few upcoming ones — like the AI planner.
  const events = []
  for (let d = -120; d <= 7; d += 1) {
    for (let h = 0; h < (d < 0 ? 4 : 1); h++) {
      const day = dayStr(TODAY, d)
      events.push({
        id: uid('e'), title: `Block ${h}`, description: 'Planned block with a short description.',
        start_time: `${day}T${String(9 + h * 2).padStart(2, '0')}:00:00.000Z`,
        end_time: `${day}T${String(10 + h * 2).padStart(2, '0')}:00:00.000Z`,
        is_all_day: false, googleEventId: 'g' + uid('g').slice(0, 20),
      })
    }
  }
  storeSet('calendar_events', events)
  storeSet('journal_entries', Array.from({ length: 25 }, (_, i) => ({
    id: uid('j'), date: dayStr(TODAY, -i), text: 'A short reflection. '.repeat(20), tags: ['life'],
  })))
  storeSet('gym_workout_logs', Array.from({ length: 30 }, (_, i) => ({
    id: uid('w'), date: dayStr(TODAY, -i * 2),
    exercises: [{ name: 'Bench Press', sets: [{ weight: 80, reps: 8 }, { weight: 80, reps: 7 }] }],
  })))
  storeSet('gym_settings', { unit: 'kg', rest: 120 })
  storeSet('general_tasks', Array.from({ length: 8 }, (_, i) => ({ id: uid('g'), text: `General ${i}` })))
}

// ── assertions ──────────────────────────────────────────────────────────────────────
const sortDeep = (v) => {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') {
    const o = {}
    Object.keys(v).sort().forEach(k => { o[k] = sortDeep(v[k]) })
    return o
  }
  return v
}
const syncedKeys = () => {
  const keys = STATIC_SYNC_KEYS.filter(k => localStorage.getItem(k) !== null)
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (DYNAMIC_SYNC_PREFIXES.some(p => k.startsWith(p))) keys.push(k)
  }
  return keys
}

export function snapshot(dev) {
  return inDevice(dev, () => {
    const out = {}
    syncedKeys().forEach(k => { out[k] = JSON.stringify(sortDeep(comparable(k, JSON.parse(localStorage.getItem(k))))) })
    return out
  })
}

export function assertConverged(a, b, label) {
  const sa = snapshot(a), sb = snapshot(b)
  assert.deepEqual(Object.keys(sa).sort(), Object.keys(sb).sort(), `${label}: synced keys differ`)
  for (const k of Object.keys(sa)) assert.equal(sa[k], sb[k], `${label}: ${k} differs between ${a.name} and ${b.name}`)
}

// Every synced key a device holds is on the server — split keys reassembled from both rows.
export function assertServerHasEverything(dev, supa, label) {
  const snap = snapshot(dev)
  for (const [k, v] of Object.entries(snap)) {
    const holders = supa.server.rows.filter(r => r.data && k in r.data)
    assert.ok(holders.length, `${label}: ${k} is on no server row`)
    let serverValue
    if (k === 'calendar_events') {
      const byId = new Map()
      holders.forEach(r => r.data[k].forEach(e => byId.set(e.id, e)))
      serverValue = [...byId.values()]
    }
    const ok = serverValue
      ? JSON.stringify(sortDeep(comparable(k, serverValue))) === v
      : holders.some(r => JSON.stringify(sortDeep(comparable(k, r.data[k]))) === v)
    assert.ok(ok, `${label}: server copy of ${k} is stale`)
  }
}

export const totals = (...devs) => devs.reduce((t, d) => {
  for (const [k, v] of Object.entries(d.stats)) t[k] = (t[k] || 0) + v
  return t
}, {})

export { clone }
