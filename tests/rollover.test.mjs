// Rollover: which unfinished tasks follow you into today.
//
// The history below reproduces the Nov 2026 incident with made-up tasks: a backlog of
// never-ticked tasks carried for months, a gap where one device never received a day,
// and a handful of genuinely current tasks.
import './helpers/env.mjs'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetStorage } from './helpers/env.mjs'

// Freeze the clock: rollover works from the active date.
const RealDate = Date
let now = 0
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [now])) }
  static now() { return now }
}
const setToday = (day) => { now = RealDate.parse(`${day}T15:00:00`) }

const { doRollover, taskSince, CARRY_MAX_DAYS } = await import('../src/lib/init.js')

const norm = (t) => t.trim().toLowerCase().replace(/\s+/g, ' ')
const set = (k, v) => localStorage.setItem(k, JSON.stringify(v))
const get = (k) => JSON.parse(localStorage.getItem(k) || 'null')
const backlog = Array.from({ length: 12 }, (_, i) => `Old chore ${i}`)
const current = ['Book flights', 'Email landlord', 'Return parcel']
const carried = (day, texts) => texts.map(t => ({ id: `ro:${day}:${norm(t)}`, text: t, done: false }))

function seedIncident() {
  // Created in July, carried along ever since (never ticked).
  set('goals:2026-07-01', backlog.map((t, i) => ({ id: `u-${i}`, text: t, done: false })))
  for (const d of ['2026-07-02', '2026-09-15', '2026-10-27', '2026-11-12', '2026-11-15']) set(`goals:${d}`, carried(d, backlog))
  // Nov 21: the device used that day never received Nov 15, so only today's new tasks.
  set('goals:2026-11-21', current.map((t, i) => ({ id: `n-${i}`, text: t, done: false })))
  // Nov 27: another device later rolled both in.
  set('goals:2026-11-27', carried('2026-11-27', [...backlog, ...current]))
  set('rollover_done_v1', Object.fromEntries(
    ['2026-07-01', '2026-07-02', '2026-09-15', '2026-10-27', '2026-11-12', '2026-11-15', '2026-11-21'].map(d => [d, 1])))
}

beforeEach(() => { resetStorage() })

test('only tasks first planned within the last week are carried', () => {
  seedIncident()
  setToday('2026-11-28')
  doRollover()
  const today = get('goals:2026-11-28')
  assert.deepEqual(today.map(t => t.text).sort(), [...current].sort())
  assert.ok(today.every(t => t.since === '2026-11-21'))
  assert.ok(get('rollover_done_v1')['2026-11-27'], 'source day retired')
})

test('the trace back to a task\'s first day skips days that never received it', () => {
  seedIncident()
  const hist = Object.entries({
    '2026-07-01': get('goals:2026-07-01'), '2026-11-15': get('goals:2026-11-15'),
    '2026-11-21': get('goals:2026-11-21'), '2026-11-27': get('goals:2026-11-27'),
  })
  const [stale] = get('goals:2026-11-27')
  const fresh = get('goals:2026-11-27').find(t => t.text === current[0])
  assert.equal(taskSince(stale, '2026-11-27', hist), '2026-07-01')
  assert.equal(taskSince(fresh, '2026-11-27', hist), '2026-11-21')
})

test('lists the old rule already filled are cleaned up, as tracked deletions', () => {
  seedIncident()
  set('goals:2026-11-28', carried('2026-11-28', [...backlog, ...current]))
  set('rollover_done_v1', { ...get('rollover_done_v1'), '2026-11-27': 1 })
  setToday('2026-11-28')
  doRollover()
  assert.deepEqual(get('goals:2026-11-28').map(t => t.text).sort(), [...current].sort())
  const tombs = get('_item_tombs_v1')['goals:2026-11-28']
  assert.equal(Object.keys(tombs).length, backlog.length, 'each removal recorded so other devices drop it too')
  doRollover() // relaunch: stable
  assert.equal(get('goals:2026-11-28').length, current.length)
})

test('a task you add today is never removed, even if an old one had the same name', () => {
  seedIncident()
  set('goals:2026-11-28', [...carried('2026-11-28', backlog), { id: 'mine', text: backlog[0], done: false }])
  set('rollover_done_v1', { ...get('rollover_done_v1'), '2026-11-27': 1 })
  setToday('2026-11-28')
  doRollover()
  assert.deepEqual(get('goals:2026-11-28').map(t => t.id), ['mine'])
})

test(`a task stops being carried ${CARRY_MAX_DAYS} days after it was first planned`, () => {
  seedIncident()
  setToday('2026-11-28')
  doRollover()
  setToday('2026-11-29')
  doRollover()
  assert.deepEqual(get('goals:2026-11-29') || [], [], 'Nov 21 tasks are 8 days old on Nov 29')
})

test('only the most recent unretired day is carried; older ones are still retired', () => {
  set('rollover_done_v1', {})
  set('goals:2026-11-25', [{ id: 'a', text: 'Only on the 25th', done: false }])
  set('goals:2026-11-26', [{ id: 'b', text: 'On the 26th', done: false }])
  setToday('2026-11-27')
  doRollover()
  assert.deepEqual(get('goals:2026-11-27').map(t => t.text), ['On the 26th'])
  const done = get('rollover_done_v1')
  assert.ok(done['2026-11-25'] && done['2026-11-26'])
})

test('first run with no rollover record retires history without carrying anything', () => {
  set('goals:2026-11-20', [{ id: 'a', text: 'x', done: false }])
  setToday('2026-11-27')
  doRollover()
  assert.equal(get('goals:2026-11-27'), null)
  assert.ok(get('rollover_done_v1')['2026-11-20'])
})
