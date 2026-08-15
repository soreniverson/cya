/**
 * Single, normalised source for the Supabase connection values.
 *
 * `.trim()` is not paranoia: the production values have carried a trailing
 * newline. The URL parser silently strips newlines, so the clients kept
 * working and nothing surfaced — until code started comparing the URL as a
 * string (see lib/storage.ts), which then silently did nothing.
 */
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  .trim()
  .replace(/\/+$/, '')

export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
