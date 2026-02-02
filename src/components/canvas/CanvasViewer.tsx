'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
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
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isSearchMode, setIsSearchMode] = useState(false)

  // Debounce search query (150ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 150)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Zoom state (for slider sync)
  const [zoomPercent, setZoomPercent] = useState(zoomToPercent(DEFAULT_ZOOM))

  // Lightbox state
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null)

  // Compute filtered indices (uses debounced search for performance)
  const filteredIndices = useMemo(() => {
    const indices = new Set<number>()
    const lowerQuery = debouncedSearchQuery.toLowerCase()

    concepts.forEach((concept, index) => {
      const matchesSearch =
        !debouncedSearchQuery ||
        concept.title.toLowerCase().includes(lowerQuery) ||
        concept.caption?.toLowerCase().includes(lowerQuery)

      const matchesCategory =
        !selectedCategory || concept.category === selectedCategory

      if (matchesSearch && matchesCategory) {
        indices.add(index)
      }
    })

    // Debug logging
    if (selectedCategory) {
      console.log(`Filter: "${selectedCategory}" -> ${indices.size}/${concepts.length} concepts match`)
    }

    return indices
  }, [concepts, debouncedSearchQuery, selectedCategory])

  // Cluster mode: only when actively searching with text (not just category filtering)
  // Category filtering just dims cards in place - no expensive clustering
  const isClusterMode = isSearchMode && debouncedSearchQuery.length > 0

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
        isClusterMode={isClusterMode}
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
