'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ConceptCard } from '@/components/concept-card'
import { ConceptGridSkeleton } from '@/components/concept-skeleton'
import type { Concept } from '@/lib/types'

interface ConceptGridProps {
  initialConcepts: Concept[]
  totalCount: number
}

const PAGE_SIZE = 24

export function ConceptGrid({ initialConcepts, totalCount }: ConceptGridProps) {
  const searchParams = useSearchParams()
  const category = searchParams.get('category')
  const search = searchParams.get('q')

  const [concepts, setConcepts] = useState<Concept[]>(initialConcepts)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(initialConcepts.length < totalCount)
  const observerRef = useRef<HTMLDivElement>(null)

  // Reset when filters change
  useEffect(() => {
    setConcepts(initialConcepts)
    setPage(0)
    setHasMore(initialConcepts.length < totalCount)
  }, [initialConcepts, totalCount])

  // Fetch more concepts
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return

    setLoading(true)
    const nextPage = page + 1

    try {
      const params = new URLSearchParams()
      params.set('page', nextPage.toString())
      if (category) params.set('category', category)
      if (search) params.set('q', search)

      const res = await fetch(`/api/concepts?${params.toString()}`)
      const data = await res.json()

      if (data.concepts.length > 0) {
        setConcepts((prev) => [...prev, ...data.concepts])
        setPage(nextPage)
        setHasMore(concepts.length + data.concepts.length < data.totalCount)
      } else {
        setHasMore(false)
      }
    } catch (error) {
      console.error('Error loading more concepts:', error)
    } finally {
      setLoading(false)
    }
  }, [loading, hasMore, page, category, search, concepts.length])

  // Intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadMore()
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    )

    if (observerRef.current) {
      observer.observe(observerRef.current)
    }

    return () => observer.disconnect()
  }, [hasMore, loading, loadMore])

  const displayCount = concepts.length
  const showingText =
    displayCount === totalCount
      ? `${totalCount} concepts`
      : `Showing ${displayCount} of ${totalCount} concepts`

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-6">{showingText}</p>

      {concepts.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-muted-foreground">No concepts found</p>
          {(search || category) && (
            <p className="text-sm text-muted-foreground mt-2">
              Try adjusting your search or filter
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {concepts.map((concept) => (
            <ConceptCard key={concept.id} concept={concept} />
          ))}
          {loading && <ConceptGridSkeleton count={PAGE_SIZE} />}
        </div>
      )}

      {/* Intersection observer target */}
      <div ref={observerRef} className="h-10" />
    </div>
  )
}
