import { supabase } from './supabase.js'

const CUSTOM_KEY = 'custom_exercises'

export function getCustomExercises() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || [] } catch { return [] }
}

export function addCustomExercise(name, primary_muscle) {
  const normalized = name.trim()
  if (!normalized) return false
  const existing = getCustomExercises()
  if (existing.some(e => e.name.toLowerCase() === normalized.toLowerCase())) return false
  existing.push({ name: normalized, primary_muscle, is_custom: true })
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(existing))
  return true
}

export function deleteCustomExercise(name) {
  const existing = getCustomExercises()
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(existing.filter(e => e.name !== name)))
}

let allExercisesMap = null
let fetchPromise = null

// Normalise legacy muscle values from old DB schema or old localStorage
function normaliseMuscle(m) {
  if (m === 'abs') return 'core'
  if (m === 'arms') return 'biceps'
  return m || 'other'
}

async function fetchAll() {
  if (allExercisesMap) return allExercisesMap
  if (fetchPromise) return fetchPromise

  fetchPromise = supabase
    .from('exercises')
    .select('name, primary_muscle')
    .then(({ data }) => {
      allExercisesMap = new Map(
        (data || []).map(e => [e.name.toLowerCase(), normaliseMuscle(e.primary_muscle)])
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
  const key = name.toLowerCase().trim()
  if (map.has(key)) return map.get(key)
  const custom = getCustomExercises()
  return normaliseMuscle(custom.find(e => e.name.toLowerCase() === key)?.primary_muscle) ?? 'other'
}

export async function lookupMusclesBatch(names) {
  const map = await fetchAll()
  const custom = getCustomExercises()
  const customMap = new Map(custom.map(e => [e.name.toLowerCase(), e.primary_muscle]))
  const result = {}
  for (const name of names) {
    if (!name) continue
    const key = name.toLowerCase().trim()
    result[name] = normaliseMuscle(map.get(key) ?? customMap.get(key) ?? 'other')
  }
  return result
}

// Search exercises by name — merges Supabase + custom exercises
export async function searchExercises(query, limit = 12) {
  if (!query || query.trim().length < 2) return []
  const { data } = await supabase
    .from('exercises')
    .select('name, primary_muscle')
    .ilike('name', `%${query.trim()}%`)
    .limit(limit)
  const q = query.trim().toLowerCase()
  const custom = getCustomExercises().filter(e => e.name.toLowerCase().includes(q))
  const seen = new Set()
  return [...(data || []), ...custom].filter(e => {
    const k = e.name.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, limit)
}

// Browse exercises with optional muscle group filter — merges Supabase + custom exercises
export async function browseExercisesByMuscle(muscle, limit = 500) {
  let query = supabase.from('exercises').select('name, primary_muscle').order('name').limit(limit)
  if (muscle && muscle !== 'all') query = query.eq('primary_muscle', muscle)
  const { data } = await query
  const custom = getCustomExercises()
  const filtered = muscle && muscle !== 'all'
    ? custom.filter(e => e.primary_muscle === muscle)
    : custom
  const seen = new Set()
  return [...filtered, ...(data || [])].filter(e => {
    const k = e.name.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
