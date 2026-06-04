/**
 * One-time seed script — populates the `exercises` table in Supabase.
 * Run: node src/scripts/seedExercises.js
 *
 * Before running, create the table in Supabase SQL editor:
 *
 *   create table if not exists exercises (
 *     id            uuid primary key default gen_random_uuid(),
 *     name          text unique not null,
 *     primary_muscle text not null check (
 *                     primary_muscle in ('chest','shoulders','back','biceps','triceps','abs','legs','other')
 *                   ),
 *     secondary_muscles text[] default '{}',
 *     created_at    timestamptz default now()
 *   );
 *
 *   -- Allow read by anon key (app uses this for lookup)
 *   alter table exercises enable row level security;
 *   create policy "public read" on exercises for select using (true);
 *   -- Allow insert/upsert with service role key (used only by this script)
 *   create policy "service insert" on exercises for insert with check (true);
 *
 * Set env vars if you want to override hardcoded keys:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY as fallback)
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'https://wlrdwrlxkjgubdmntfxl.supabase.co'
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  'sb_publishable_yUHmrdeFSaKfY-AMGp3r9Q_Q2Mbqh7Y'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// prettier-ignore
const EXERCISES = [
  // ── CHEST ──────────────────────────────────────────────────────
  { name: 'Barbell Bench Press',         primary_muscle: 'chest',     secondary_muscles: ['shoulders', 'triceps'] },
  { name: 'Dumbbell Bench Press',        primary_muscle: 'chest',     secondary_muscles: ['shoulders', 'triceps'] },
  { name: 'Flat Dumbbell Press',         primary_muscle: 'chest',     secondary_muscles: ['shoulders', 'triceps'] },
  { name: 'Incline Barbell Bench Press', primary_muscle: 'chest',     secondary_muscles: ['shoulders', 'triceps'] },
  { name: 'Incline Dumbbell Bench Press',primary_muscle: 'chest',     secondary_muscles: ['shoulders', 'triceps'] },
  { name: 'Decline Bench Press',         primary_muscle: 'chest',     secondary_muscles: ['triceps', 'shoulders'] },
  { name: 'Decline Dumbbell Bench Press',primary_muscle: 'chest',     secondary_muscles: ['triceps'] },
  { name: 'Cable Fly',                   primary_muscle: 'chest',     secondary_muscles: ['shoulders'] },
  { name: 'Dumbbell Fly',                primary_muscle: 'chest',     secondary_muscles: ['shoulders'] },
  { name: 'Pec Deck',                    primary_muscle: 'chest',     secondary_muscles: [] },
  { name: 'Push-Up',                     primary_muscle: 'chest',     secondary_muscles: ['triceps', 'shoulders'] },
  { name: 'Chest Dip',                   primary_muscle: 'chest',     secondary_muscles: ['triceps', 'shoulders'] },
  { name: 'Dip',                         primary_muscle: 'chest',     secondary_muscles: ['triceps', 'shoulders'] },
  { name: 'Low Cable Crossover',         primary_muscle: 'chest',     secondary_muscles: ['shoulders'] },
  { name: 'High Cable Crossover',        primary_muscle: 'chest',     secondary_muscles: ['shoulders'] },
  { name: 'Machine Chest Press',         primary_muscle: 'chest',     secondary_muscles: ['triceps', 'shoulders'] },
  { name: 'Svend Press',                 primary_muscle: 'chest',     secondary_muscles: ['shoulders'] },
  { name: 'Cable Chest Press',           primary_muscle: 'chest',     secondary_muscles: ['triceps', 'shoulders'] },
  { name: 'Incline Cable Fly',           primary_muscle: 'chest',     secondary_muscles: ['shoulders'] },
  { name: 'Incline Machine Chest Press', primary_muscle: 'chest',     secondary_muscles: ['shoulders', 'triceps'] },
  { name: 'Decline Machine Chest Press', primary_muscle: 'chest',     secondary_muscles: ['triceps'] },

  // ── SHOULDERS ──────────────────────────────────────────────────
  { name: 'Overhead Press',             primary_muscle: 'shoulders',  secondary_muscles: ['triceps', 'back'] },
  { name: 'Barbell Overhead Press',     primary_muscle: 'shoulders',  secondary_muscles: ['triceps', 'back'] },
  { name: 'Dumbbell Shoulder Press',    primary_muscle: 'shoulders',  secondary_muscles: ['triceps'] },
  { name: 'Seated Dumbbell Press',      primary_muscle: 'shoulders',  secondary_muscles: ['triceps'] },
  { name: 'Arnold Press',               primary_muscle: 'shoulders',  secondary_muscles: ['triceps'] },
  { name: 'Lateral Raise',              primary_muscle: 'shoulders',  secondary_muscles: [] },
  { name: 'Dumbbell Lateral Raise',     primary_muscle: 'shoulders',  secondary_muscles: [] },
  { name: 'Cable Lateral Raise',        primary_muscle: 'shoulders',  secondary_muscles: [] },
  { name: 'Machine Lateral Raise',      primary_muscle: 'shoulders',  secondary_muscles: [] },
  { name: 'Front Raise',                primary_muscle: 'shoulders',  secondary_muscles: ['chest'] },
  { name: 'Dumbbell Front Raise',       primary_muscle: 'shoulders',  secondary_muscles: ['chest'] },
  { name: 'Face Pull',                  primary_muscle: 'shoulders',  secondary_muscles: ['back', 'biceps'] },
  { name: 'Upright Row',                primary_muscle: 'shoulders',  secondary_muscles: ['back', 'biceps'] },
  { name: 'Rear Delt Fly',              primary_muscle: 'shoulders',  secondary_muscles: ['back'] },
  { name: 'Cable Rear Delt Fly',        primary_muscle: 'shoulders',  secondary_muscles: ['back'] },
  { name: 'Machine Shoulder Press',     primary_muscle: 'shoulders',  secondary_muscles: ['triceps'] },
  { name: 'Bradford Press',             primary_muscle: 'shoulders',  secondary_muscles: ['triceps', 'back'] },
  { name: 'Push Press',                 primary_muscle: 'shoulders',  secondary_muscles: ['triceps', 'legs'] },
  { name: 'Handstand Push-Up',          primary_muscle: 'shoulders',  secondary_muscles: ['triceps', 'back'] },
  { name: 'Pike Push-Up',               primary_muscle: 'shoulders',  secondary_muscles: ['triceps'] },

  // ── BACK ───────────────────────────────────────────────────────
  { name: 'Deadlift',                   primary_muscle: 'back',       secondary_muscles: ['legs', 'shoulders'] },
  { name: 'Barbell Row',                primary_muscle: 'back',       secondary_muscles: ['biceps', 'shoulders'] },
  { name: 'Bent-Over Row',              primary_muscle: 'back',       secondary_muscles: ['biceps', 'shoulders'] },
  { name: 'Dumbbell Row',               primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Single-Arm Dumbbell Row',    primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Lat Pulldown',               primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Close-Grip Lat Pulldown',    primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Pull-Up',                    primary_muscle: 'back',       secondary_muscles: ['biceps', 'shoulders'] },
  { name: 'Neutral Grip Pull-Up',       primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Wide-Grip Pull-Up',          primary_muscle: 'back',       secondary_muscles: ['biceps', 'shoulders'] },
  { name: 'Chin-Up',                    primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Seated Cable Row',           primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'T-Bar Row',                  primary_muscle: 'back',       secondary_muscles: ['biceps', 'shoulders'] },
  { name: 'Chest-Supported Row',        primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Machine Row',                primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Cable Row',                  primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Rack Pull',                  primary_muscle: 'back',       secondary_muscles: ['shoulders', 'legs'] },
  { name: 'Barbell Shrug',              primary_muscle: 'back',       secondary_muscles: [] },
  { name: 'Dumbbell Shrug',             primary_muscle: 'back',       secondary_muscles: [] },
  { name: 'Hyperextension',             primary_muscle: 'back',       secondary_muscles: ['legs'] },
  { name: 'Reverse Hyperextension',     primary_muscle: 'back',       secondary_muscles: ['legs'] },
  { name: 'Good Morning',               primary_muscle: 'back',       secondary_muscles: ['legs'] },
  { name: 'Pendlay Row',                primary_muscle: 'back',       secondary_muscles: ['biceps', 'shoulders'] },
  { name: 'Meadows Row',                primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Seal Row',                   primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Kroc Row',                   primary_muscle: 'back',       secondary_muscles: ['biceps'] },
  { name: 'Pull-Over',                  primary_muscle: 'back',       secondary_muscles: ['chest'] },
  { name: 'Straight-Arm Pulldown',      primary_muscle: 'back',       secondary_muscles: [] },

  // ── BICEPS ─────────────────────────────────────────────────────
  { name: 'Barbell Curl',               primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Dumbbell Curl',              primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Alternating Dumbbell Curl',  primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Hammer Curl',                primary_muscle: 'biceps',     secondary_muscles: ['back'] },
  { name: 'Preacher Curl',              primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'EZ Bar Preacher Curl',       primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'EZ Bar Curl',                primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Concentration Curl',         primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Cable Curl',                 primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Incline Dumbbell Curl',      primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Drag Curl',                  primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Machine Curl',               primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Cross Body Curl',            primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Reverse Curl',               primary_muscle: 'biceps',     secondary_muscles: ['other'] },
  { name: 'Zottman Curl',               primary_muscle: 'biceps',     secondary_muscles: ['other'] },
  { name: 'Cable Hammer Curl',          primary_muscle: 'biceps',     secondary_muscles: [] },
  { name: 'Spider Curl',                primary_muscle: 'biceps',     secondary_muscles: [] },

  // ── TRICEPS ────────────────────────────────────────────────────
  { name: 'Tricep Pushdown',            primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'Cable Pushdown',             primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'Rope Pushdown',              primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'Skull Crusher',              primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'EZ Bar Skull Crusher',       primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'Close-Grip Bench Press',     primary_muscle: 'triceps',    secondary_muscles: ['chest', 'shoulders'] },
  { name: 'Overhead Tricep Extension',  primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'Dumbbell Overhead Extension',primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'Cable Overhead Extension',   primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'Tricep Dip',                 primary_muscle: 'triceps',    secondary_muscles: ['chest', 'shoulders'] },
  { name: 'Bench Dip',                  primary_muscle: 'triceps',    secondary_muscles: ['chest', 'shoulders'] },
  { name: 'Machine Tricep Extension',   primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'JM Press',                   primary_muscle: 'triceps',    secondary_muscles: ['chest'] },
  { name: 'Tate Press',                 primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'Tricep Kickback',            primary_muscle: 'triceps',    secondary_muscles: [] },
  { name: 'Diamond Push-Up',            primary_muscle: 'triceps',    secondary_muscles: ['chest', 'shoulders'] },
  { name: 'Cable Tricep Kickback',      primary_muscle: 'triceps',    secondary_muscles: [] },

  // ── ABS ────────────────────────────────────────────────────────
  { name: 'Crunch',                     primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Sit-Up',                     primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Leg Raise',                  primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Hanging Leg Raise',          primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Plank',                      primary_muscle: 'abs',        secondary_muscles: ['shoulders', 'back'] },
  { name: 'Cable Crunch',               primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Ab Rollout',                 primary_muscle: 'abs',        secondary_muscles: ['back', 'shoulders'] },
  { name: 'Ab Wheel Rollout',           primary_muscle: 'abs',        secondary_muscles: ['back', 'shoulders'] },
  { name: 'Russian Twist',              primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Bicycle Crunch',             primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Dragon Flag',                primary_muscle: 'abs',        secondary_muscles: ['back'] },
  { name: 'Hollow Hold',                primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Dead Bug',                   primary_muscle: 'abs',        secondary_muscles: ['back'] },
  { name: 'V-Up',                       primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Side Plank',                 primary_muscle: 'abs',        secondary_muscles: ['shoulders', 'back'] },
  { name: 'Toe Touch',                  primary_muscle: 'abs',        secondary_muscles: [] },
  { name: 'Wood Chop',                  primary_muscle: 'abs',        secondary_muscles: ['shoulders', 'back'] },
  { name: 'Mountain Climber',           primary_muscle: 'abs',        secondary_muscles: ['shoulders'] },

  // ── LEGS ───────────────────────────────────────────────────────
  { name: 'Squat',                      primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Barbell Squat',              primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Front Squat',                primary_muscle: 'legs',       secondary_muscles: ['back', 'shoulders'] },
  { name: 'Goblet Squat',               primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Box Squat',                  primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Pause Squat',                primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Belt Squat',                 primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Safety Bar Squat',           primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Smith Machine Squat',        primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Leg Press',                  primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Single-Leg Press',           primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Hack Squat',                 primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Machine Hack Squat',         primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Bulgarian Split Squat',      primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Split Squat',                primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Lunge',                      primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Walking Lunge',              primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Reverse Lunge',              primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Lateral Lunge',              primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Romanian Deadlift',          primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Dumbbell Romanian Deadlift', primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Stiff-Leg Deadlift',         primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Sumo Deadlift',              primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Trap Bar Deadlift',          primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Leg Curl',                   primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Lying Leg Curl',             primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Seated Leg Curl',            primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Leg Extension',              primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Calf Raise',                 primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Standing Calf Raise',        primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Seated Calf Raise',          primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Donkey Calf Raise',          primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Hip Thrust',                 primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Glute Bridge',               primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Single-Leg Hip Thrust',      primary_muscle: 'legs',       secondary_muscles: ['back'] },
  { name: 'Nordic Curl',                primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Step-Up',                    primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Box Jump',                   primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Jump Squat',                 primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Wall Sit',                   primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Sissy Squat',                primary_muscle: 'legs',       secondary_muscles: [] },
  { name: 'Kettlebell Swing',           primary_muscle: 'legs',       secondary_muscles: ['back', 'shoulders'] },

  // ── OTHER ──────────────────────────────────────────────────────
  { name: "Farmer's Carry",             primary_muscle: 'other',      secondary_muscles: ['back', 'legs'] },
  { name: 'Farmer Walk',                primary_muscle: 'other',      secondary_muscles: ['back', 'legs'] },
  { name: 'Sled Push',                  primary_muscle: 'other',      secondary_muscles: ['legs', 'shoulders'] },
  { name: 'Sled Pull',                  primary_muscle: 'other',      secondary_muscles: ['legs', 'back'] },
  { name: 'Battle Ropes',               primary_muscle: 'other',      secondary_muscles: ['shoulders', 'back'] },
  { name: 'Burpee',                     primary_muscle: 'other',      secondary_muscles: ['chest', 'legs', 'shoulders'] },
  { name: 'Wrist Curl',                 primary_muscle: 'other',      secondary_muscles: [] },
  { name: 'Reverse Wrist Curl',         primary_muscle: 'other',      secondary_muscles: [] },
  { name: 'Power Clean',                primary_muscle: 'other',      secondary_muscles: ['legs', 'back', 'shoulders'] },
  { name: 'Hang Clean',                 primary_muscle: 'other',      secondary_muscles: ['legs', 'back', 'shoulders'] },
  { name: 'Snatch',                     primary_muscle: 'other',      secondary_muscles: ['legs', 'back', 'shoulders'] },
  { name: 'Clean and Press',            primary_muscle: 'other',      secondary_muscles: ['legs', 'back', 'shoulders'] },
  { name: 'Tire Flip',                  primary_muscle: 'other',      secondary_muscles: ['back', 'legs', 'shoulders'] },
]

async function seed() {
  console.log(`Seeding ${EXERCISES.length} exercises…`)

  const { error } = await supabase
    .from('exercises')
    .upsert(EXERCISES, { onConflict: 'name', ignoreDuplicates: false })

  if (error) {
    console.error('Seed failed:', error.message)
    process.exit(1)
  }

  console.log(`Done. ${EXERCISES.length} exercises upserted.`)
}

seed()
