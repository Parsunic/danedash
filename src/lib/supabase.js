import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://wlrdwrlxkjgubdmntfxl.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_yUHmrdeFSaKfY-AMGp3r9Q_Q2Mbqh7Y'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
