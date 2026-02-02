'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, X, Shuffle, Home, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Category } from '@/lib/types'

interface CanvasControlsProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  selectedCategory: string | null
  onCategoryChange: (category: string | null) => void
  categories: Category[]
  zoomPercent: number
  onZoomChange: (percent: number) => void
  onShuffle: () => void
  onRecenter: () => void
  filteredCount: number
  totalCount: number
}

export function CanvasControls({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  categories,
  zoomPercent,
  onZoomChange,
  onShuffle,
  onRecenter,
  filteredCount,
  totalCount,
}: CanvasControlsProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        if (e.key === 'Escape') {
          ;(e.target as HTMLElement).blur()
        }
        return
      }

      switch (e.key) {
        case '/':
          e.preventDefault()
          searchInputRef.current?.focus()
          break
        case 'r':
        case 'R':
          onShuffle()
          break
        case '0':
          onRecenter()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onShuffle, onRecenter])

  const isFiltered = searchQuery || selectedCategory

  return (
    <>
      {/* Top bar - search and filters */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4 pointer-events-none">
        <div className="flex flex-col gap-3 max-w-3xl mx-auto">
          {/* Search input */}
          <div className="relative pointer-events-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search concepts... (press / to focus)"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              className="pl-10 pr-10 bg-background/80 backdrop-blur-sm border-border/50"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={() => onSearchChange('')}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>

          {/* Category pills */}
          <div className="flex flex-wrap gap-2 pointer-events-auto">
            <Button
              variant={selectedCategory === null ? 'default' : 'outline'}
              size="xs"
              onClick={() => onCategoryChange(null)}
              className="bg-background/80 backdrop-blur-sm"
            >
              All
              <span className="text-muted-foreground ml-1">({totalCount})</span>
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat.category}
                variant={selectedCategory === cat.category ? 'default' : 'outline'}
                size="xs"
                onClick={() =>
                  onCategoryChange(
                    selectedCategory === cat.category ? null : cat.category
                  )
                }
                className="bg-background/80 backdrop-blur-sm"
              >
                {cat.category}
                <span className="text-muted-foreground ml-1">({cat.count})</span>
              </Button>
            ))}
          </div>

          {/* Filter status */}
          {isFiltered && (
            <div className="text-sm text-muted-foreground pointer-events-auto">
              Showing {filteredCount} of {totalCount} concepts
              <Button
                variant="link"
                size="xs"
                className="ml-2 h-auto p-0"
                onClick={() => {
                  onSearchChange('')
                  onCategoryChange(null)
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom left - navigation controls */}
      <div className="absolute bottom-4 left-4 z-10 flex gap-2 pointer-events-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={onShuffle}
          className="bg-background/80 backdrop-blur-sm"
          title="Shuffle (R)"
        >
          <Shuffle className="size-4" />
          <span className="hidden sm:inline">Shuffle</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRecenter}
          className="bg-background/80 backdrop-blur-sm"
          title="Recenter (0)"
        >
          <Home className="size-4" />
          <span className="hidden sm:inline">Recenter</span>
        </Button>
      </div>

      {/* Bottom right - zoom controls */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 pointer-events-auto bg-background/80 backdrop-blur-sm rounded-lg p-2 border border-border/50">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onZoomChange(Math.max(0, zoomPercent - 10))}
          disabled={zoomPercent <= 0}
        >
          <Minus className="size-3" />
        </Button>

        <input
          type="range"
          min="0"
          max="100"
          value={zoomPercent}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          className="w-20 sm:w-32 h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
        />

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onZoomChange(Math.min(100, zoomPercent + 10))}
          disabled={zoomPercent >= 100}
        >
          <Plus className="size-3" />
        </Button>

        <span className="text-xs text-muted-foreground w-10 text-right">
          {Math.round(zoomPercent)}%
        </span>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-xs text-muted-foreground/50 hidden lg:block pointer-events-none">
        Drag to pan | Scroll to zoom | R=Shuffle | 0=Recenter | /=Search | Click card to view
      </div>
    </>
  )
}
