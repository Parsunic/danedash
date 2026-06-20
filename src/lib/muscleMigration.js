import { lookupMusclesBatch } from './muscleUtils.js'
import { storeGet, storeSetSilent } from './storage.js'

function normMuscle(m) {
  if (m === 'abs') return 'core'
  if (m === 'arms') return 'biceps'
  return m || 'other'
}

// Back-fills primary_muscle on existing workout logs and templates.
// Also normalises legacy values (abs→core, arms→biceps).
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

  const muscleMap = names.size > 0 ? await lookupMusclesBatch([...names]) : {}

  let logsChanged = false
  for (const log of logs) {
    for (const ex of (log.exercises || [])) {
      const norm = normMuscle(ex.primary_muscle)
      if (!ex.primary_muscle && ex.name) {
        ex.primary_muscle = muscleMap[ex.name] ?? 'other'
        for (const set of (ex.sets || []))
          if (!set.primary_muscle) set.primary_muscle = ex.primary_muscle
        logsChanged = true
      } else if (norm !== ex.primary_muscle) {
        ex.primary_muscle = norm
        for (const set of (ex.sets || []))
          if (set.primary_muscle) set.primary_muscle = norm
        logsChanged = true
      }
    }
  }
  if (logsChanged) storeSet('gym_workout_logs', logs)

  let tplsChanged = false
  for (const tpl of templates) {
    for (const ex of (tpl.exercises || [])) {
      const norm = normMuscle(ex.primary_muscle)
      if (!ex.primary_muscle && ex.name) {
        ex.primary_muscle = muscleMap[ex.name] ?? 'other'
        tplsChanged = true
      } else if (norm !== ex.primary_muscle) {
        ex.primary_muscle = norm
        tplsChanged = true
      }
    }
  }
  if (tplsChanged) storeSet('gym_templates', templates)
}
