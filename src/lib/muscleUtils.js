import { supabase } from './supabase.js'

let allExercisesMap = null
let fetchPromise = null

async function fetchAll() {
  if (allExercisesMap) return allExercisesMap
  if (fetchPromise) return fetchPromise

  fetchPromise = supabase
    .from('exercises')
    .select('name, primary_muscle')
    .then(({ data }) => {
      allExercisesMap = new Map(
        (data || []).map(e => [e.name.toLowerCase(), e.primary_muscle])
      )
      fetchPromise = null
      return allExercisesMap
    })
    .catch(() => {
      fetchPromise = null
      allExercisesMap = new Map()
      return allExercisesMap
    })

  return fetchPromise
}

export async function lookupMuscle(name) {
  if (!name) return 'other'
  const map = await fetchAll()
  return map.get(name.toLowerCase().trim()) ?? 'other'
}

// Returns { [originalName]: primaryMuscle } for each name in the array
export async function lookupMusclesBatch(names) {
  const map = await fetchAll()
  const result = {}
  for (const name of names) {
    if (!name) continue
    result[name] = map.get(name.toLowerCase().trim()) ?? 'other'
  }
  return result
}

// Search exercises by name (partial match), returns [{ name, primary_muscle }]
export async function searchExercises(query, limit = 12) {
  if (!query || query.trim().length < 2) return []
  const { data } = await supabase
    .from('exercises')
    .select('name, primary_muscle')
    .ilike('name', `%${query.trim()}%`)
    .limit(limit)
  return data || []
}
