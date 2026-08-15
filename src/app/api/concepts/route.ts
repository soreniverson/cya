import { NextRequest, NextResponse } from 'next/server'
import { getConcepts } from '@/lib/queries'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const rawPage = searchParams.get('page')
  const category = searchParams.get('category')
  const search = searchParams.get('q')

  // An unvalidated parseInt turns `?page=abc` into offset=NaN, which PostgREST
  // answers with an empty 200 - infinite scroll just silently stops.
  const page = rawPage === null ? 0 : Number(rawPage)
  if (!Number.isInteger(page) || page < 0 || page > 10_000) {
    return NextResponse.json(
      { error: 'Invalid `page`: expected a non-negative integer.' },
      { status: 400 }
    )
  }

  try {
    const { concepts, totalCount } = await getConcepts({ page, category, search })

    return NextResponse.json(
      { concepts, totalCount },
      {
        headers: {
          // Safe to cache publicly: this route reads no cookies and returns
          // only published rows.
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    )
  } catch (error) {
    console.error('Error fetching concepts:', error)
    return NextResponse.json({ error: 'Failed to fetch concepts' }, { status: 500 })
  }
}
