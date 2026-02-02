import { Suspense } from 'react'
import { Metadata } from 'next'
import { SearchBar } from '@/components/search-bar'
import { CategoryFilter } from '@/components/category-filter'
import { ConceptGrid } from '@/components/concept-grid'
import { ConceptGridSkeleton } from '@/components/concept-skeleton'
import { getConcepts, getCategories } from '@/lib/queries'

export const metadata: Metadata = {
  title: 'Directory | Can You Imagine',
  description: 'Browse all AI-generated concepts in a searchable directory.',
}

export const revalidate = 60 // ISR: revalidate every 60 seconds

interface DirectoryPageProps {
  searchParams: Promise<{ category?: string; q?: string }>
}

export default async function DirectoryPage({ searchParams }: DirectoryPageProps) {
  const params = await searchParams
  const category = params.category ?? null
  const search = params.q ?? null

  const [{ concepts, totalCount }, categories] = await Promise.all([
    getConcepts({ category, search }),
    getCategories(),
  ])

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h1 className="text-lg font-medium tracking-tight">Can You Imagine</h1>
            <Suspense fallback={null}>
              <SearchBar />
            </Suspense>
          </div>
        </div>
      </header>

      {/* Category Filter */}
      <div className="border-b border-border bg-background">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <Suspense fallback={null}>
            <CategoryFilter categories={categories} />
          </Suspense>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <Suspense
          fallback={
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              <ConceptGridSkeleton count={24} />
            </div>
          }
        >
          <ConceptGrid initialConcepts={concepts} totalCount={totalCount} />
        </Suspense>
      </div>
    </main>
  )
}
