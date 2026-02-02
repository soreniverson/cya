'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, X, Dices, Info, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Category } from '@/lib/types'

type ControlMode = 'zoom' | 'search' | 'filter'

interface CanvasControlsProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  selectedCategory: string | null
  onCategoryChange: (category: string | null) => void
  categories: Category[]
  zoomPercent: number
  onZoomChange: (percent: number) => void
  onRandomConcept: () => void
  onSearchModeChange: (isSearching: boolean) => void
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
  onRandomConcept,
  onSearchModeChange,
  filteredCount,
  totalCount,
}: CanvasControlsProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<ControlMode>('zoom')
  const [isInfoOpen, setIsInfoOpen] = useState(false)

  // Focus search input when entering search mode
  useEffect(() => {
    if (mode === 'search') {
      setTimeout(() => searchInputRef.current?.focus(), 150)
    }
  }, [mode])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        if (e.key === 'Escape') {
          setMode('zoom')
          onSearchChange('')
          onSearchModeChange(false)
          ;(e.target as HTMLElement).blur()
        }
        return
      }

      switch (e.key) {
        case '/':
          e.preventDefault()
          setMode('search')
          onSearchModeChange(true)
          break
        case 'r':
        case 'R':
          onRandomConcept()
          break
        case 'Escape':
          setMode('zoom')
          onSearchModeChange(false)
          setIsInfoOpen(false)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onRandomConcept, onSearchChange, onSearchModeChange])

  const toggleMode = (targetMode: ControlMode) => {
    if (mode === targetMode) {
      setMode('zoom')
      if (targetMode === 'search') {
        onSearchChange('')
        onSearchModeChange(false)
      }
    } else {
      setMode(targetMode)
      onSearchModeChange(targetMode === 'search')
    }
  }

  return (
    <>
      {/* Vignette overlay */}
      <div className="pointer-events-none fixed inset-0 z-[1]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_30%,rgba(0,0,0,0.6)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 to-transparent" />
      </div>

      {/* Bottom controls bar */}
      <div className="absolute bottom-6 left-6 right-6 z-10 pointer-events-none">
        <div className="flex items-center justify-between gap-3">
          {/* Left side - Filter and Search buttons */}
          <div className="flex gap-2 pointer-events-auto">
            <ControlButton
              active={mode === 'filter'}
              onClick={() => toggleMode('filter')}
              title="Filter by category"
            >
              <SlidersHorizontal className="size-[18px]" />
            </ControlButton>
            <ControlButton
              active={mode === 'search'}
              onClick={() => toggleMode('search')}
              title="Search (press /)"
            >
              <div className="relative size-[18px]">
                <Search
                  className={cn(
                    "size-[18px] absolute inset-0 transition-all duration-150",
                    mode === 'search' ? "opacity-0 rotate-90 scale-75" : "opacity-100 rotate-0 scale-100"
                  )}
                />
                <X
                  className={cn(
                    "size-[18px] absolute inset-0 transition-all duration-150",
                    mode === 'search' ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-75"
                  )}
                />
              </div>
            </ControlButton>
          </div>

          {/* Center - Context-aware control */}
          <div className="flex-1 flex justify-center pointer-events-auto">
            {/* Zoom slider */}
            <div
              className={cn(
                "transition-all duration-150",
                mode === 'zoom'
                  ? "opacity-100 scale-100"
                  : "opacity-0 scale-95 pointer-events-none absolute"
              )}
            >
              <div className="control-surface px-5 h-11 flex items-center">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={zoomPercent}
                  onChange={(e) => onZoomChange(Number(e.target.value))}
                  className="zoom-slider w-36 sm:w-48"
                />
              </div>
            </div>

            {/* Search input */}
            <div
              className={cn(
                "transition-all duration-150",
                mode === 'search'
                  ? "opacity-100 scale-100"
                  : "opacity-0 scale-95 pointer-events-none absolute"
              )}
            >
              <div className="control-surface px-4 h-11 flex items-center w-72 sm:w-96">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search concepts..."
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-full bg-transparent text-sm text-center text-white placeholder:text-neutral-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Filter pills */}
            <div
              className={cn(
                "transition-all duration-150",
                mode === 'filter'
                  ? "opacity-100 scale-100"
                  : "opacity-0 scale-95 pointer-events-none absolute"
              )}
            >
              <div className="control-surface px-2 h-11 flex items-center gap-1 overflow-x-auto max-w-[60vw] scrollbar-none">
                <FilterPill
                  active={selectedCategory === null}
                  onClick={() => onCategoryChange(null)}
                >
                  All
                </FilterPill>
                {categories.map((cat) => (
                  <FilterPill
                    key={cat.category}
                    active={selectedCategory === cat.category}
                    onClick={() => onCategoryChange(
                      selectedCategory === cat.category ? null : cat.category
                    )}
                  >
                    {cat.category}
                  </FilterPill>
                ))}
              </div>
            </div>
          </div>

          {/* Right side - Info and Random buttons */}
          <div className="flex gap-2 pointer-events-auto">
            <ControlButton
              onClick={() => setIsInfoOpen(true)}
              title="About"
            >
              <Info className="size-[18px]" />
            </ControlButton>
            <ControlButton
              onClick={onRandomConcept}
              title="Random concept (R)"
            >
              <Dices className="size-[18px]" />
            </ControlButton>
          </div>
        </div>
      </div>

      {/* Info modal */}
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center transition-all duration-150",
          isInfoOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsInfoOpen(false)}
        />
        <div
          className={cn(
            "relative modal-surface p-6 max-w-md mx-4 transition-all duration-150",
            isInfoOpen ? "scale-100" : "scale-95"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-medium text-white">About</h2>
            <button
              onClick={() => setIsInfoOpen(false)}
              className="size-7 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/5 transition-colors duration-150"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="text-neutral-400 text-sm leading-relaxed space-y-4">
            <p><span className="text-white">"Can You Imagine?"</span> is an ongoing series of fictional interface designs by Soren Iverson.</p>
            <p>Each piece takes a familiar digital experience and subverts it in an unexpected way. The designs look real, but are unhinged or dystopian, representing the absurdity of dark patterns and behaviors normalized by large technology companies.</p>
            <p>These interfaces have been shared widely online, often because people genuinely weren't sure if what they were looking at was fake. In some cases, concepts have since been shipped by real companies (DoorDash financing options, Instagram algorithm controls).</p>
            <p>The work has been featured in <span className="text-neutral-300">Wired</span>, <span className="text-neutral-300">Creative Review</span>, <span className="text-neutral-300">Business Insider</span>, <span className="text-neutral-300">Reuters</span>, <span className="text-neutral-300">SF Gate</span>, <span className="text-neutral-300">Snopes</span>, and more. Soren continues to make interfaces, though not on a daily basis as he did for the first two years of this practice. All concepts were created by Soren in Figma and other design tools.</p>
            <div className="pt-2 text-xs text-neutral-500">
              <p>Site design – Soren Iverson</p>
              <p>Site development – Claude Code</p>
            </div>
          </div>
        </div>
      </div>

      {/* Custom styles */}
      <style jsx>{`
        .control-surface {
          background: rgba(38, 38, 38, 0.85);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 9999px;
        }

        .modal-surface {
          background: rgba(23, 23, 23, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
        }

        .zoom-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 2px;
          cursor: pointer;
        }

        .zoom-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          transition: transform 0.15s ease;
        }

        .zoom-slider::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }

        .zoom-slider::-webkit-slider-thumb:active {
          transform: scale(0.95);
        }

        .zoom-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: white;
          border: none;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }

        .scrollbar-none {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </>
  )
}

function ControlButton({
  children,
  active,
  onClick,
  title
}: {
  children: React.ReactNode
  active?: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "size-11 rounded-full flex items-center justify-center transition-all duration-150",
        "bg-neutral-800/85 backdrop-blur-xl border border-white/[0.06]",
        "text-neutral-300 hover:text-white",
        active && "ring-1 ring-white/20 ring-inset"
      )}
    >
      {children}
    </button>
  )
}

function FilterPill({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150",
        active
          ? "bg-white/15 text-white"
          : "text-neutral-400 hover:text-white hover:bg-white/5"
      )}
    >
      {children}
    </button>
  )
}
