import { cache } from 'react'
import { createStaticClient } from '@/lib/supabase/static'
import { toStoragePath } from '@/lib/storage'
import type { CanvasConcept, Concept, Category } from '@/lib/types'

const PAGE_SIZE = 24

// Never `*`: that ships the generated `search_vector` tsvector to every browser.
// Everything the public pages actually render, and nothing else.
const PUBLIC_COLUMNS =
  'id, slug, title, caption, image_url, thumbnail_url, mid_url, image_width, image_height, category, date_posted'

// The canvas renders ~1000 rows into the initial payload, so it takes the
// narrowest set that still covers the grid tiles and the lightbox.
const CANVAS_COLUMNS =
  'id, slug, title, caption, image_url, thumbnail_url, mid_url, category, date_posted, atlas_slot'

/**
 * Public reads use the cookie-free client on purpose. Reaching for `cookies()`
 * here opts every page into dynamic rendering, which silently disables the
 * `revalidate` exports and makes the homepage uncacheable at the edge.
 */
function publicClient() {
  const supabase = createStaticClient()
  if (!supabase) {
    throw new Error(
      'Supabase env vars are missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)'
    )
  }
  return supabase
}

export async function getConcepts({
  page = 0,
  category,
  search,
}: {
  page?: number
  category?: string | null
  search?: string | null
}): Promise<{ concepts: Concept[]; totalCount: number }> {
  const supabase = publicClient()
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0

  let query = supabase
    .from('concepts')
    .select(PUBLIC_COLUMNS, { count: 'exact' })
    .eq('is_published', true)
    .order('date_posted', { ascending: false, nullsFirst: false })
    .range(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE - 1)

  if (category) {
    query = query.eq('category', category)
  }

  if (search) {
    query = query.textSearch('search_vector', search, {
      type: 'websearch',
      config: 'english',
    })
  }

  const { data, count, error } = await query

  if (error) {
    console.error('Error fetching concepts:', error)
    return { concepts: [], totalCount: 0 }
  }

  return {
    concepts: (data ?? []) as unknown as Concept[],
    totalCount: count ?? 0,
  }
}

/**
 * Wrapped in `cache()` so the concept page and its `generateMetadata` share one
 * query per request instead of issuing the same lookup twice.
 */
export const getConceptBySlug = cache(async function getConceptBySlug(
  slug: string
): Promise<Concept | null> {
  const supabase = publicClient()

  const { data, error } = await supabase
    .from('concepts')
    .select(PUBLIC_COLUMNS)
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle()

  if (error) {
    console.error('Error fetching concept:', error)
    return null
  }

  return (data ?? null) as unknown as Concept | null
})

export async function getAdjacentConcepts(
  currentSlug: string,
  category?: string | null
): Promise<{ prev: Concept | null; next: Concept | null }> {
  const supabase = publicClient()

  // Reuses the cached lookup above rather than issuing a third query.
  const current = await getConceptBySlug(currentSlug)

  // A null date_posted would produce `date_posted=lt.null`, which Postgres
  // rejects with 22007. There is no meaningful neighbour without a date.
  if (!current?.date_posted) {
    return { prev: null, next: null }
  }

  // Get previous (older) concept
  let prevQuery = supabase
    .from('concepts')
    .select(PUBLIC_COLUMNS)
    .eq('is_published', true)
    .lt('date_posted', current.date_posted)
    .order('date_posted', { ascending: false })
    .limit(1)

  // Get next (newer) concept
  let nextQuery = supabase
    .from('concepts')
    .select(PUBLIC_COLUMNS)
    .eq('is_published', true)
    .gt('date_posted', current.date_posted)
    .order('date_posted', { ascending: true })
    .limit(1)

  if (category) {
    prevQuery = prevQuery.eq('category', category)
    nextQuery = nextQuery.eq('category', category)
  }

  const [prevResult, nextResult] = await Promise.all([prevQuery, nextQuery])

  if (prevResult.error) console.error('Error fetching previous concept:', prevResult.error)
  if (nextResult.error) console.error('Error fetching next concept:', nextResult.error)

  return {
    prev: (prevResult.data?.[0] ?? null) as unknown as Concept | null,
    next: (nextResult.data?.[0] ?? null) as unknown as Concept | null,
  }
}

export const getCategories = cache(async function getCategories(): Promise<Category[]> {
  const supabase = publicClient()

  const { data, error } = await supabase
    .from('concepts')
    .select('category')
    .eq('is_published', true)
    .not('category', 'is', null)

  if (error) {
    console.error('Error fetching categories:', error)
    return []
  }

  // Count occurrences manually
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    if (row.category) {
      counts[row.category] = (counts[row.category] || 0) + 1
    }
  }

  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
})

export async function getTotalCount(): Promise<number> {
  const supabase = publicClient()

  const { count, error } = await supabase
    .from('concepts')
    .select('id', { count: 'exact', head: true })
    .eq('is_published', true)

  if (error) {
    console.error('Error fetching count:', error)
    return 0
  }

  return count ?? 0
}

export const getAllConcepts = cache(async function getAllConcepts(): Promise<CanvasConcept[]> {
  const supabase = publicClient()

  const { data, error } = await supabase
    .from('concepts')
    .select(CANVAS_COLUMNS)
    .eq('is_published', true)
    .order('date_posted', { ascending: false, nullsFirst: false })

  if (error) {
    // Deliberately rethrow. Returning [] here used to render an empty canvas,
    // which hangs the tab on the zero-concept grid math; let the route's error
    // boundary handle an outage instead of pretending the archive is empty.
    console.error('Error fetching all concepts:', error)
    throw new Error(`Failed to load concepts: ${error.message}`)
  }

  // Every row goes into the initial page payload, so strip the storage prefix
  // the three URL columns all share. The client reattaches it via
  // fromStoragePath(). Worth ~216 KB across 964 concepts.
  return ((data ?? []) as unknown as CanvasConcept[]).map((c) => ({
    ...c,
    image_url: toStoragePath(c.image_url) as string,
    thumbnail_url: toStoragePath(c.thumbnail_url),
    mid_url: toStoragePath(c.mid_url),
  }))
})
