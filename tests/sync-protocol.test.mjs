// Multi-device sync protocol: several simulated devices running the real sync engine
// against a fake Supabase that enforces compare-and-swap and counts every byte it sends.
//
// One long, ordered scenario — each step starts from the state the previous one left,
// the way real devices accumulate history. The thing that matters most is at the end of
// most steps: once devices agree, they must go QUIET. The bug that exhausted the egress
// quota (Nov 2026) was two devices that never went quiet.
import './helpers/env.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wait } from './helpers/env.mjs'
import { createFakeSupabase, newStats } from './helpers/fakeSupabase.mjs'
import {
  makeDevice, inDevice, startCurrent, startLegacy, stopDevice, legacy, legacyPayload,
  seedData, storeSet, uid, dayStr, TODAY, FAST, assertConverged, assertServerHasEverything, clone,
} from './helpers/devices.mjs'

const { archiveCutoff, isArchivedKey, isArchivedRecord } = await import('../src/lib/syncKeys.js')

const supa = createFakeSupabase()
const { server } = supa
const devices = []
const device = (name, opts) => { const d = makeDevice(name, opts); devices.push(d); return d }
const resetStats = () => devices.forEach(d => { d.stats = newStats() })
const pushes = (...ds) => ds.reduce((n, d) => n + d.stats.update + d.stats.insert, 0)
const downloads = (...ds) => ds.reduce((n, d) => n + d.stats.full, 0)
const local = (dev, key) => inDevice(dev, () => JSON.parse(localStorage.getItem(key)))
const edit = (dev, key, fn) => inDevice(dev, () => storeSet(key, fn(JSON.parse(localStorage.getItem(key)))))

const A = device('laptop')
const B = device('phone')

test('sync protocol', async (t) => {
  // Starting point: production before the rework. Both devices hold the same data; the
  // server's single row was written by the legacy build (all keys, unscoped metadata).
  inDevice(A, () => seedData())
  const T0 = Date.now() - 60000
  supa.putRow('dane', inDevice(A, () => legacyPayload()), T0)
  inDevice(B, () => legacy.merge.applyRemote(clone(supa.row('dane').data), T0))
  const before = supa.rowSize('dane')

  await t.test('first boot on the new build: archive row created, data intact', async () => {
    await startCurrent(A, supa)
    await startCurrent(B, supa)
    await wait(400)
    assertConverged(A, B, 'boot')
    assertServerHasEverything(A, supa, 'boot')
    assert.ok(supa.row('dane_archive'), 'archive row created')
    assert.ok(downloads(A, B) <= 4, 'boot downloads bounded')
  })

  await t.test('main row carries only recent history; archive carries the rest', async () => {
    resetStats()
    edit(A, `goals:${TODAY}`, l => [...l, { id: uid('t'), text: 'New task', done: false, date: TODAY }])
    await wait(400)
    assertConverged(A, B, 'edit')
    assertServerHasEverything(A, supa, 'edit')
    const cutoff = archiveCutoff(TODAY)
    const main = supa.row('dane').data
    const archive = supa.row('dane_archive').data
    assert.ok(!Object.keys(main).some(k => isArchivedKey(k, cutoff)), 'no archived keys in main')
    assert.ok(main.calendar_events.every(e => !isArchivedRecord('calendar_events', e, cutoff)), 'main: recent events only')
    assert.ok(archive.calendar_events.every(e => isArchivedRecord('calendar_events', e, cutoff)), 'archive: past events only')
    assert.equal(main.calendar_events.length + archive.calendar_events.length, local(A, 'calendar_events').length)
    assert.ok(supa.rowSize('dane') < before * 0.3, `main row shrank (${supa.rowSize('dane')} vs ${before})`)
    assert.ok(downloads(B) <= 1, 'phone downloaded the small main row at most once')
  })

  await t.test('both devices add an event before seeing each other: converges, then quiet', async () => {
    resetStats()
    const add = (dev, title) => edit(dev, 'calendar_events', l => [...l, {
      id: uid('e'), title, start_time: `${dayStr(TODAY, 2)}T09:00:00.000Z`, end_time: `${dayStr(TODAY, 2)}T10:00:00.000Z`,
    }])
    await Promise.all([add(A, 'Laptop event'), add(B, 'Phone event')])
    await wait(1500)
    assertConverged(A, B, 'concurrent')
    assertServerHasEverything(A, supa, 'concurrent')
    assert.ok(pushes(A, B) <= 6, `settled (pushes=${pushes(A, B)})`)
    resetStats()
    await wait(1300)
    assert.equal(pushes(A, B) + downloads(A, B), 0, 'no traffic beyond timestamp polls once settled')
  })

  await t.test('reload with nothing changed: no download, no push', async () => {
    resetStats()
    stopDevice(A)
    await startCurrent(A, supa)
    await wait(200)
    assert.equal(downloads(A), 0)
    assert.equal(pushes(A), 0)
  })

  await t.test('editing a 40-day-old task pushes only the archive row', async () => {
    resetStats()
    const oldDay = `goals:${dayStr(TODAY, -40)}`
    edit(B, oldDay, l => l.map((x, i) => (i === 0 ? { ...x, done: !x.done } : x)))
    await wait(400)
    assertConverged(A, B, 'archive edit')
    assert.equal(pushes(B), 1)
  })

  await t.test('editing a past calendar event pushes only the archive row', async () => {
    resetStats()
    const pastDay = dayStr(TODAY, -60)
    edit(B, 'calendar_events', l => l.map(e => (e.start_time.startsWith(pastDay) ? { ...e, title: 'Renamed' } : e)))
    await wait(400)
    assertConverged(A, B, 'past event edit')
    assert.equal(pushes(B), 1)
    assert.ok(supa.row('dane_archive').data.calendar_events.some(e => e.title === 'Renamed'))
  })

  await t.test('adding an upcoming event pushes only the main row', async () => {
    resetStats()
    edit(A, 'calendar_events', l => [...l, { id: uid('e'), title: 'Dentist', start_time: `${dayStr(TODAY, 3)}T15:00:00.000Z`, end_time: `${dayStr(TODAY, 3)}T16:00:00.000Z` }])
    await wait(400)
    assertConverged(A, B, 'new event')
    assert.equal(pushes(A), 1)
  })

  await t.test('deleting a past event propagates and does not come back', async () => {
    resetStats()
    const victim = local(A, 'calendar_events').find(e => e.start_time.startsWith(dayStr(TODAY, -90)))
    edit(A, 'calendar_events', l => l.filter(e => e.id !== victim.id))
    await wait(600)
    assertConverged(A, B, 'past delete')
    assert.ok(!local(B, 'calendar_events').some(e => e.id === victim.id), 'gone on the phone')
    assert.ok(!supa.row('dane_archive').data.calendar_events.some(e => e.id === victim.id), 'gone from the archive row')
    resetStats()
    await wait(1300)
    assert.equal(pushes(A, B), 0, 'quiet afterwards')
  })

  await t.test('an edit made just before the app is killed goes out on the next launch', async () => {
    resetStats()
    edit(B, 'gym_settings', () => ({ unit: 'lb', rest: 90 }))
    stopDevice(B)
    await startCurrent(B, supa)
    await wait(400)
    assertConverged(A, B, 'killed tab')
    assert.equal(local(A, 'gym_settings').unit, 'lb')
  })

  await t.test('a hidden tab downloads nothing until it is shown, then catches up once', async () => {
    resetStats()
    A.visible = false
    for (let i = 0; i < 5; i++) {
      edit(B, `goals:${TODAY}`, l => [...l, { id: uid('t'), text: `Burst ${i}`, done: false, date: TODAY }])
      await wait(220)
    }
    await wait(200)
    assert.equal(downloads(A), 0)
    A.visible = true
    await inDevice(A, () => A.engine.revalidate('focus'))
    await wait(200)
    assert.ok(downloads(A) <= 1)
    assertConverged(A, B, 'hidden')
  })

  await t.test('a week later, history moves into the archive in one batch, then quiet', async () => {
    resetStats()
    A.date = dayStr(TODAY, 7); B.date = dayStr(TODAY, 7)
    edit(A, 'gym_settings', () => ({ unit: 'lb', rest: 60 }))
    await wait(800)
    assertConverged(A, B, 'week rollover')
    assertServerHasEverything(A, supa, 'week rollover')
    const cutoff = archiveCutoff(A.date)
    assert.ok(supa.row('dane').data.calendar_events.every(e => !isArchivedRecord('calendar_events', e, cutoff)))
    resetStats()
    await wait(1300)
    assert.equal(pushes(A, B) + downloads(A, B), 0)
  })

  await t.test('a row written without metadata (very old build) is repaired once', async () => {
    resetStats()
    const data = clone(supa.row('dane').data)
    delete data.__meta_v2
    data.habits = [...data.habits, { id: 'h3', name: 'Meditate' }]
    supa.putRow('dane', data)
    await inDevice(A, () => A.engine.revalidate('signal'))
    await inDevice(B, () => B.engine.revalidate('signal'))
    await wait(800)
    assertConverged(A, B, 'legacy row')
    assert.ok(supa.row('dane').data.__meta_v2, 'metadata restored')
  })

  await t.test('circuit breaker: a writer that keeps reverting a value cannot drain the quota', async () => {
    resetStats()
    let stop = false
    const rogue = supa.clientFor({ stats: newStats() }).channel('ultradash-sync-signal-v1', {})
    ;(async () => {
      while (!stop) {
        const d = clone(supa.row('dane').data)
        d.gym_settings = { unit: 'stone', rest: 1 }
        d.__meta_v2.keyTs.gym_settings = 1 // claims to be ancient, so B keeps its own and pushes back
        supa.putRow('dane', d)
        rogue.send({ type: 'broadcast', event: 'row-changed', payload: { row: 'dane', at: supa.row('dane').updated_at } })
        await wait(120)
      }
    })()
    A.visible = false
    await wait(2500)
    const during = B.stats.update
    await wait(1500)
    const after = B.stats.update - during
    stop = true
    A.visible = true
    assert.ok(inDevice(B, () => B.engine._state().tripped), 'breaker tripped')
    assert.ok(during <= FAST.breakerMax + 1, `pushes capped (${during})`)
    assert.equal(after, 0, 'no pushes after tripping')
    await wait(200)
    resetStats()
    edit(B, 'gym_settings', () => ({ unit: 'kg', rest: 75 }))
    await wait(300)
    assert.ok(B.stats.update >= 1, 'a real edit resumes pushing')
    assert.equal(inDevice(B, () => B.engine._state().tripped), false)
    await wait(800)
  })

  await t.test('mixed fleet: a tab still on the legacy build converges and everyone goes quiet', async () => {
    const C = device('old-tab')
    inDevice(C, () => legacy.merge.applyRemote(clone(supa.row('dane').data), Date.now() - 1000))
    // The old tab had all history locally before the update (including every past event).
    const history = inDevice(A, () => {
      const out = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (/^(goals|habits_log):/.test(k) || k === 'calendar_events') out[k] = localStorage.getItem(k)
      }
      return out
    })
    inDevice(C, () => Object.entries(history).forEach(([k, v]) => localStorage.setItem(k, v)))
    await startLegacy(C, supa)
    await wait(300)
    resetStats()
    const add = (dev, title) => edit(dev, 'calendar_events', l => [...l, { id: uid('e'), title, start_time: `${dayStr(TODAY, 9)}T08:00:00.000Z`, end_time: `${dayStr(TODAY, 9)}T09:00:00.000Z` }])
    for (let i = 0; i < 4; i++) { add(i % 2 ? A : B, `mixed ${i}`); await wait(300) }
    inDevice(C, () => legacy.storage.storeSet('calendar_events', [...JSON.parse(localStorage.getItem('calendar_events')), { id: uid('e'), title: 'from old tab', start_time: `${dayStr(TODAY, 9)}T11:00:00.000Z`, end_time: `${dayStr(TODAY, 9)}T12:00:00.000Z` }]))
    await wait(1500)
    assertConverged(A, B, 'mixed')
    const ids = (dev) => new Set(local(dev, 'calendar_events').map(e => e.id))
    assert.deepEqual([...ids(C)].sort(), [...ids(A)].sort(), 'old tab converged on events')
    resetStats()
    await wait(1500)
    assert.equal(pushes(A, B, C), 0, 'all quiet once settled')
    stopDevice(C)
  })

  for (const d of devices) stopDevice(d)
})

test('archive row refused by the server: sync still works, no error, no retry storm', async () => {
  const s2 = createFakeSupabase()
  s2.server.rejectInsert = 'dane_archive'
  const D = makeDevice('fresh-1'), E = makeDevice('fresh-2')
  inDevice(D, () => seedData())
  await startCurrent(D, s2)
  await wait(300)
  await startCurrent(E, s2)
  await wait(600)
  assertConverged(D, E, 'no archive')
  assertServerHasEverything(D, s2, 'no archive')
  assert.equal(D.status, 'synced')
  assert.ok(!s2.row('dane_archive'))
  assert.ok(D.stats.insert <= 2, `no immediate insert retries (${D.stats.insert})`)
  stopDevice(D); stopDevice(E)
})
