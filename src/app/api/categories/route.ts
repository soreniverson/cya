import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Category } from '@/lib/types'

export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('concepts')
    .select('category')
    .eq('is_published', true)
    .not('category', 'is', null)

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    )
  }

  // Count occurrences manually
  const counts: Record<string, number> = {}
  for (const row of data) {
    if (row.category) {
      counts[row.category] = (counts[row.category] || 0) + 1
    }
  }

  const categories: Category[] = Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({ categories })
}
