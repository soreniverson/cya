'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import type { Concept, Category } from '@/lib/types'
import { PixiCanvas, type PixiCanvasHandle } from './PixiCanvas'
import { CanvasControls } from './CanvasControls'
import { ConceptLightbox } from './ConceptLightbox'
import { percentToZoom, zoomToPercent, DEFAULT_ZOOM } from './canvas-utils'

interface CanvasViewerProps {
  concepts: Concept[]
  categories: Category[]
}

export function CanvasViewer({ concepts, categories }: CanvasViewerProps) {
  const canvasRef = useRef<PixiCanvasHandle>(null)

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isSearchMode, setIsSearchMode] = useState(false)

  // Zoom state (for slider sync)
  const [zoomPercent, setZoomPercent] = useState(zoomToPercent(DEFAULT_ZOOM))

  // Lightbox state
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null)

  // Compute filtered indices
  const filteredIndices = useMemo(() => {
    const indices = new Set<number>()
    const lowerQuery = searchQuery.toLowerCase()

    concepts.forEach((concept, index) => {
      const matchesSearch =
        !searchQuery ||
        concept.title.toLowerCase().includes(lowerQuery) ||
        concept.caption?.toLowerCase().includes(lowerQuery)

      const matchesCategory =
        !selectedCategory || concept.category === selectedCategory

      if (matchesSearch && matchesCategory) {
        indices.add(index)
      }
    })

    return indices
  }, [concepts, searchQuery, selectedCategory])

  // Handlers
  const handleCardClick = useCallback((concept: Concept) => {
    setSelectedConcept(concept)
  }, [])

  const handleZoomChange = useCallback((percent: number) => {
    setZoomPercent(percent)
    canvasRef.current?.setZoom(percentToZoom(percent))
  }, [])

  const handleZoomFromCanvas = useCallback((percent: number) => {
    setZoomPercent(percent)
  }, [])

  const handleRandomConcept = useCallback(() => {
    const randomIndex = Math.floor(Math.random() * concepts.length)
    setSelectedConcept(concepts[randomIndex])
  }, [concepts])

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      {/* PixiJS Canvas Layer */}
      <PixiCanvas
        ref={canvasRef}
        concepts={concepts}
        filteredIndices={filteredIndices}
        isSearchMode={(isSearchMode && searchQuery.length > 0) || selectedCategory !== null}
        onCardClick={handleCardClick}
        onZoomChange={handleZoomFromCanvas}
      />

      {/* DOM Control Layer */}
      <CanvasControls
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        categories={categories}
        zoomPercent={zoomPercent}
        onZoomChange={handleZoomChange}
        onRandomConcept={handleRandomConcept}
        onSearchModeChange={setIsSearchMode}
        filteredCount={filteredIndices.size}
        totalCount={concepts.length}
      />

      {/* Lightbox */}
      <ConceptLightbox
        concept={selectedConcept}
        onClose={() => setSelectedConcept(null)}
      />
    </div>
  )
}
