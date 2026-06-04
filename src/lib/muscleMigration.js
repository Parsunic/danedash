import { lookupMusclesBatch } from './muscleUtils.js'
import { storeGet, storeSet } from './storage.js'

// Back-fills primary_muscle on existing workout logs and templates.
// Runs on every Gym mount but exits immediately once all exercises are tagged.
export async function runMuscleMigration() {
  const logs = storeGet('gym_workout_logs') || []
  const templates = storeGet('gym_templates') || []

  const names = new Set()
  for (const log of logs)
    for (const ex of (log.exercises || []))
      if (!ex.primary_muscle && ex.name) names.add(ex.name)
  for (const tpl of templates)
    for (const ex of (tpl.exercises || []))
      if (!ex.primary_muscle && ex.name) names.add(ex.name)

  if (names.size === 0) return

  const muscleMap = await lookupMusclesBatch([...names])

  let logsChanged = false
  for (const log of logs) {
    for (const ex of (log.exercises || [])) {
      if (!ex.primary_muscle && ex.name) {
        ex.primary_muscle = muscleMap[ex.name] ?? 'other'
        for (const set of (ex.sets || []))
          if (!set.primary_muscle) set.primary_muscle = ex.primary_muscle
        logsChanged = true
      }
    }
  }
  if (logsChanged) storeSet('gym_workout_logs', logs)

  let tplsChanged = false
  for (const tpl of templates) {
    for (const ex of (tpl.exercises || [])) {
      if (!ex.primary_muscle && ex.name) {
        ex.primary_muscle = muscleMap[ex.name] ?? 'other'
        tplsChanged = true
      }
    }
  }
  if (tplsChanged) storeSet('gym_templates', templates)
}
