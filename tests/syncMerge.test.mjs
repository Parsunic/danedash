// Merge rules that decide whether a device thinks the server is missing something. Every
// one of these, if wrong, makes two devices push at each other forever.
import './helpers/env.mjs'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetStorage } from './helpers/env.mjs'

const { applyRemote, comparable, mergeValue, NO_CHANGE } = await import('../src/lib/syncMerge.js')

const meta = (keyTs = {}) => ({ w: 2, keyTs, keyTombs: {}, itemTombs: {} })
const set = (k, v) => localStorage.setItem(k, JSON.stringify(v))
const get = (k) => JSON.parse(localStorage.getItem(k))

beforeEach(() => { resetStorage() })

test('unordered lists compare as sets; ordered lists by position', () => {
  const a = [{ id: 'a' }, { id: 'b' }]
  const b = [{ id: 'b' }, { id: 'a' }]
  assert.deepEqual(comparable('calendar_events', a), comparable('calendar_events', b))
  assert.notDeepEqual(comparable('goals:2026-11-21', a), comparable('goals:2026-11-21', b))
})

test('same records in a different order do not need a push (the Nov 2026 loop)', () => {
  set('calendar_events', [{ id: 'x', _ts: 1 }, { id: 'a', _ts: 2 }, { id: 'b', _ts: 3 }])
  set('_key_ts_v1', { calendar_events: 3 })
  const remote = { calendar_events: [{ id: 'x', _ts: 1 }, { id: 'b', _ts: 3 }, { id: 'a', _ts: 2 }], __meta_v2: meta({ calendar_events: 3 }) }
  assert.equal(applyRemote(remote, 3).needsPush, false)
})

test('a genuinely missing record does need a push', () => {
  set('calendar_events', [{ id: 'x', _ts: 1 }, { id: 'mine', _ts: 5 }])
  set('_key_ts_v1', { calendar_events: 5 })
  const remote = { calendar_events: [{ id: 'x', _ts: 1 }], __meta_v2: meta({ calendar_events: 1 }) }
  assert.equal(applyRemote(remote, 1).needsPush, true)
})

test('keys no push carries never count as "missing from the server"', () => {
  set('finance:2026-10', [{ id: 'old' }])        // a key this build no longer syncs
  set('_key_ts_v1', { 'finance:2026-10': 9 })
  set('habits', [{ id: 'h1' }])
  const remote = { habits: [{ id: 'h1' }], __meta_v2: meta() }
  assert.equal(applyRemote(remote, 1).needsPush, false)
})

test('incoming keys this build does not sync are ignored, not written', () => {
  const remote = { 'finance:2026-10': [{ id: 'x' }], finance_budgets: { food: 100 }, __meta_v2: meta() }
  const { needsPush } = applyRemote(remote, 1)
  assert.equal(needsPush, false)
  assert.equal(localStorage.getItem('finance:2026-10'), null)
  assert.equal(localStorage.getItem('finance_budgets'), null)
})

test('keys outside a row\'s scope are merged but never trigger a push', () => {
  set('_key_ts_v1', {})
  const remote = { 'goals:2026-01-05': [{ id: 't1', text: 'old' }], habits: [], __meta_v2: meta() }
  const r = applyRemote(remote, 1, { inScope: (k) => !k.startsWith('goals:') })
  assert.equal(r.needsPush, false)
  assert.deepEqual(get('goals:2026-01-05').map(t => t.id), ['t1'], 'still merged in')
})

test('split keys: one row\'s part of a list is judged against our part, not our whole list', () => {
  const past = { id: 'p', end_time: '2026-01-01T10:00:00.000Z', _ts: 1 }
  const recent = { id: 'r', end_time: '2026-11-20T10:00:00.000Z', _ts: 1 }
  set('calendar_events', [past, recent])
  set('_key_ts_v1', { calendar_events: 1 })
  const archivePart = { calendar_events: [past], __meta_v2: meta({ calendar_events: 1 }) }
  const onlyArchived = (k, v) => (k === 'calendar_events' ? v.filter(e => e.end_time < '2026-11-01') : v)

  assert.equal(applyRemote(archivePart, 1).needsPush, true, 'whole-list comparison would push forever')
  assert.equal(applyRemote(archivePart, 1, { project: onlyArchived }).needsPush, false)
  assert.deepEqual(get('calendar_events').map(e => e.id).sort(), ['p', 'r'], 'local list stays whole')
})

test('a split key that cannot be merged record by record is never replaced by one row\'s part', () => {
  const local = [{ id: 'a', end_time: '2026-11-20' }, { id: 'b', end_time: '2026-01-01' }]
  const part = [{ end_time: '2026-01-01' }] // no id → not identifiable
  assert.equal(mergeValue('calendar_events', local, part, 1, 99), NO_CHANGE)
})

test('a deletion newer than the surviving copy wins; an edit newer than the deletion survives', () => {
  set('calendar_events', [{ id: 'gone', _ts: 1 }, { id: 'edited', _ts: 50 }])
  set('_key_ts_v1', { calendar_events: 50 })
  const remote = {
    calendar_events: [],
    __meta_v2: { w: 2, keyTs: { calendar_events: 40 }, keyTombs: {}, itemTombs: { calendar_events: { gone: 10, edited: 10 } } },
  }
  applyRemote(remote, 40)
  assert.deepEqual(get('calendar_events').map(e => e.id), ['edited'])
})
