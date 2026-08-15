/**
 * Image URLs are stored in full, but every one of them starts with the same
 * ~73-character origin + bucket prefix. Across 964 concepts x 3 tiers that
 * repeated string was 216 KB of the homepage payload — 40% of it — so the
 * server strips it and the client puts it back.
 */
export const STORAGE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const STORAGE_PREFIX = `${STORAGE_ORIGIN}/storage/v1/object/public/concepts/`

/** Full URL -> bare object path. Leaves anything unrecognised untouched. */
export function toStoragePath(url: string | null): string | null {
  if (!url) return url
  return url.startsWith(STORAGE_PREFIX) ? url.slice(STORAGE_PREFIX.length) : url
}

/**
 * Bare object path -> full URL. Passes absolute URLs straight through, so rows
 * pointing at some other host keep working.
 */
export function fromStoragePath(path: string | null): string | null {
  if (!path) return path
  return /^https?:\/\//.test(path) ? path : STORAGE_PREFIX + path
}
