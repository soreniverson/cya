import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Concept } from '@/lib/types'

const PAGE_SIZE = 24

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') ?? '0')
  const category = searchParams.get('category')
  const search = searchParams.get('q')

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
    return NextResponse.json(
      { error: 'Failed to fetch concepts' },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      concepts: data as Concept[],
      totalCount: count ?? 0,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    }
  )
}
