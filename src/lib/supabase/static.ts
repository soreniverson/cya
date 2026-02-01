import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Client for use in static generation contexts (no cookies/request)
// Returns null if env vars are not set (e.g., during build without env)
export function createStaticClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return null
  }

  return createSupabaseClient(url, key)
}
