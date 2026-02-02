import { createClient } from '@/lib/supabase/server'
import type { Concept, Category } from '@/lib/types'

const PAGE_SIZE = 24

export async function getConcepts({
  page = 0,
  category,
  search,
}: {
  page?: number
  category?: string | null
  search?: string | null
}): Promise<{ concepts: Concept[]; totalCount: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('concepts')
    .select('*', { count: 'exact' })
    .eq('is_published', true)
    .order('date_posted', { ascending: false, nullsFirst: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

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
    concepts: data as Concept[],
    totalCount: count ?? 0,
  }
}

export async function getConceptBySlug(slug: string): Promise<Concept | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('concepts')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .single()

  if (error) {
    console.error('Error fetching concept:', error)
    return null
  }

  return data as Concept
}

export async function getAdjacentConcepts(
  currentSlug: string,
  category?: string | null
): Promise<{ prev: Concept | null; next: Concept | null }> {
  const supabase = await createClient()

  // Get current concept's date
  const { data: current } = await supabase
    .from('concepts')
    .select('date_posted')
    .eq('slug', currentSlug)
    .single()

  if (!current) {
    return { prev: null, next: null }
  }

  // Get previous (older) concept
  let prevQuery = supabase
    .from('concepts')
    .select('id, slug, title')
    .eq('is_published', true)
    .lt('date_posted', current.date_posted)
    .order('date_posted', { ascending: false })
    .limit(1)

  if (category) {
    prevQuery = prevQuery.eq('category', category)
  }

  // Get next (newer) concept
  let nextQuery = supabase
    .from('concepts')
    .select('id, slug, title')
    .eq('is_published', true)
    .gt('date_posted', current.date_posted)
    .order('date_posted', { ascending: true })
    .limit(1)

  if (category) {
    nextQuery = nextQuery.eq('category', category)
  }

  const [{ data: prevData }, { data: nextData }] = await Promise.all([
    prevQuery,
    nextQuery,
  ])

  return {
    prev: prevData?.[0] as Concept | null,
    next: nextData?.[0] as Concept | null,
  }
}

export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient()

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
  for (const row of data) {
    if (row.category) {
      counts[row.category] = (counts[row.category] || 0) + 1
    }
  }

  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
}

export async function getTotalCount(): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('concepts')
    .select('*', { count: 'exact', head: true })
    .eq('is_published', true)

  if (error) {
    console.error('Error fetching count:', error)
    return 0
  }

  return count ?? 0
}

export async function getAllConcepts(): Promise<Concept[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('concepts')
    .select('*')
    .eq('is_published', true)
    .order('date_posted', { ascending: false, nullsFirst: false })

  if (error) {
    console.error('Error fetching all concepts:', error)
    return []
  }

  return data as Concept[]
}
