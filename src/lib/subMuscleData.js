// Sub-muscle taxonomy used by body diagram and radar chart.
// primary_sub_muscles / secondary_sub_muscles columns in Supabase exercises table use these values.

export const ALL_SUB_MUSCLES = [
  // front-visible
  'chest', 'front_delt', 'mid_delt', 'biceps', 'forearms',
  'upper_abs', 'lower_abs', 'obliques', 'quads', 'adductors',
  // back-visible
  'traps', 'rear_delt', 'lats', 'mid_back', 'lower_back',
  'triceps', 'glutes', 'hamstrings', 'calves',
]

// The 6 radar axes and which sub-muscles contribute to each
export const RADAR_GROUPS = {
  Arms:      ['biceps', 'triceps', 'forearms'],
  Back:      ['traps', 'mid_back', 'lats', 'lower_back'],
  Legs:      ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'],
  Chest:     ['chest'],
  Shoulders: ['front_delt', 'mid_delt', 'rear_delt'],
  Core:      ['upper_abs', 'lower_abs', 'obliques'],
}

// Maps our internal sub-muscle taxonomy onto the muscle names used by
// react-body-highlighter (which has a fixed, coarser anatomical set).
export const SUB_TO_LIB_MUSCLE = {
  chest: 'chest',
  front_delt: 'front-deltoids',
  mid_delt: 'front-deltoids',
  rear_delt: 'back-deltoids',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearm',
  traps: 'trapezius',
  lats: 'upper-back',
  mid_back: 'upper-back',
  lower_back: 'lower-back',
  upper_abs: 'abs',
  lower_abs: 'abs',
  obliques: 'obliques',
  quads: 'quadriceps',
  hamstrings: 'hamstring',
  glutes: 'gluteal',
  calves: 'calves',
  adductors: 'adductor',
}

// Default sub-muscles when not stored in DB, derived from primary_muscle
export const DEFAULT_SUB_MUSCLES = {
  chest:     { primary: ['chest'],            secondary: ['front_delt', 'triceps'] },
  shoulders: { primary: ['mid_delt'],          secondary: ['traps'] },
  back:      { primary: ['lats', 'mid_back'],  secondary: ['biceps', 'rear_delt'] },
  biceps:    { primary: ['biceps'],            secondary: ['forearms'] },
  triceps:   { primary: ['triceps'],           secondary: [] },
  legs:      { primary: ['quads', 'glutes'],   secondary: ['hamstrings'] },
  core:      { primary: ['upper_abs', 'lower_abs'], secondary: ['obliques'] },
  other:     { primary: [],                   secondary: [] },
}

// System prompt fragment used by AI when generating sub-muscles for a custom exercise
export const SUB_MUSCLE_AI_PROMPT = `Given an exercise name, return JSON with the primary and secondary sub-muscles worked.
Use ONLY values from this list: chest, front_delt, mid_delt, rear_delt, biceps, forearms, triceps, traps, lats, mid_back, lower_back, upper_abs, lower_abs, obliques, quads, hamstrings, glutes, calves, adductors.
Return: {"primary_sub_muscles": [...], "secondary_sub_muscles": [...]}`
