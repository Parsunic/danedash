// Which keys (and which calendar records) live in the archive row.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { archiveCutoff, isArchivedKey, isArchivedRecord, isSplitKey, isSyncedKey } from '../src/lib/syncKeys.js'

test('cutoff is 14 days back, snapped to the Monday on or before', () => {
  assert.equal(archiveCutoff('2026-11-21'), '2026-11-02') // Nov 7 (Sat) → Mon Nov 2
  assert.equal(archiveCutoff('2026-11-28'), '2026-11-09') // Nov 14 (Sat) → Mon Nov 9
  assert.equal(archiveCutoff('2026-11-23'), '2026-11-09') // Nov 9 is itself a Monday
  assert.equal(archiveCutoff('garbage'), '0000-00-00')    // unparseable → archive nothing
})

test('the cutoff moves in weekly batches, not daily', () => {
  const week = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']
  assert.equal(new Set(week.map(archiveCutoff)).size, 1)
})

test('dated history is archived by the last day it covers', () => {
  const cutoff = '2026-11-09'
  assert.equal(isArchivedKey('goals:2026-11-08', cutoff), true)
  assert.equal(isArchivedKey('goals:2026-11-09', cutoff), false)
  assert.equal(isArchivedKey('daily_focus:2026-10-01', cutoff), true)
  assert.equal(isArchivedKey('habits_log:2026-W45', cutoff), true)   // ends Sun Nov 8
  assert.equal(isArchivedKey('habits_log:2026-W46', cutoff), false)  // ends Sun Nov 15
  assert.equal(isArchivedKey('journal_synthesis:2026-10', cutoff), true)
  assert.equal(isArchivedKey('journal_synthesis:2026-11', cutoff), false) // month not over
  assert.equal(isArchivedKey('calendar_events', cutoff), false)
  assert.equal(isArchivedKey('habits', cutoff), false)
})

test('calendar events split by record end date; undated records stay in main', () => {
  const cutoff = '2026-11-09'
  assert.equal(isSplitKey('calendar_events'), true)
  assert.equal(isSplitKey('journal_entries'), false)
  assert.equal(isArchivedRecord('calendar_events', { end_time: '2026-11-08T23:00:00.000Z' }, cutoff), true)
  assert.equal(isArchivedRecord('calendar_events', { end_time: '2026-11-09T00:30:00.000Z' }, cutoff), false)
  assert.equal(isArchivedRecord('calendar_events', { start_time: '2026-01-01T09:00:00.000Z' }, cutoff), true)
  assert.equal(isArchivedRecord('calendar_events', { title: 'no date' }, cutoff), false)
})

test('Finances no longer syncs', () => {
  assert.equal(isSyncedKey('finance:2026-11'), false)
  assert.equal(isSyncedKey('finance_budgets'), false)
  assert.equal(isSyncedKey('calendar_events'), true)
})
