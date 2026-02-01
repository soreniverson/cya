'use client'

import { useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Category } from '@/lib/types'

interface CategoryFilterProps {
  categories: Category[]
}

export function CategoryFilter({ categories }: CategoryFilterProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const activeCategory = searchParams.get('category')

  const setCategory = useCallback(
    (category: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (category) {
        params.set('category', category)
      } else {
        params.delete('category')
      }
      startTransition(() => {
        router.push(`?${params.toString()}`, { scroll: false })
      })
    },
    [router, searchParams]
  )

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
      <button
        onClick={() => setCategory(null)}
        className={cn(
          'shrink-0 px-3 py-1.5 text-sm rounded-full transition-colors duration-150',
          !activeCategory
            ? 'bg-foreground text-background'
            : 'bg-secondary text-muted-foreground hover:text-foreground'
        )}
      >
        All
      </button>
      {categories.map(({ category, count }) => (
        <button
          key={category}
          onClick={() => setCategory(category)}
          className={cn(
            'shrink-0 px-3 py-1.5 text-sm rounded-full transition-colors duration-150',
            activeCategory === category
              ? 'bg-foreground text-background'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          )}
        >
          {category}
          <span className="ml-1.5 text-xs opacity-60">{count}</span>
        </button>
      ))}
    </div>
  )
}
