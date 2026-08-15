import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env'

// Client for use in static generation contexts (no cookies/request)
// Returns null if env vars are not set (e.g., during build without env)
export function createStaticClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null
  }

  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}
