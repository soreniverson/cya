'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import type { Concept, Category } from '@/lib/types'
import { PixiCanvas, type PixiCanvasHandle } from './PixiCanvas'
import { CanvasControls } from './CanvasControls'
import { ConceptLightbox } from './ConceptLightbox'
import { percentToZoom, zoomToPercent, DEFAULT_ZOOM, MIN_ZOOM, CELL_SIZE } from './canvas-utils'

interface CanvasViewerProps {
  concepts: Concept[]
  categories: Category[]
}

export function CanvasViewer({ concepts, categories }: CanvasViewerProps) {
  const canvasRef = useRef<PixiCanvasHandle>(null)

  // Filter state
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // Zoom state (for slider sync)
  const [zoomPercent, setZoomPercent] = useState(zoomToPercent(DEFAULT_ZOOM))

  // Lightbox state
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null)

  // Compute filtered indices
  const filteredIndices = useMemo(() => {
    const indices = new Set<number>()

    concepts.forEach((concept, index) => {
      const matchesCategory =
        !selectedCategory || concept.category === selectedCategory

      if (matchesCategory) {
        indices.add(index)
      }
    })

    return indices
  }, [concepts, selectedCategory])

  // Cluster mode: when filtering by category
  const isClusterMode = selectedCategory !== null

  // Auto-zoom to fit filtered items when filter changes
  useEffect(() => {
    if (selectedCategory && filteredIndices.size > 0) {
      // Calculate zoom needed to fit all filtered items
      const count = filteredIndices.size
      const cols = Math.ceil(Math.sqrt(count * 1.5))
      const rows = Math.ceil(count / cols)

      // Estimate cluster size in pixels
      const clusterWidth = cols * CELL_SIZE
      const clusterHeight = rows * CELL_SIZE

      // Get viewport size - account for controls (more on mobile)
      const viewportWidth = window.innerWidth
      const isMobile = viewportWidth < 640
      const controlsHeight = isMobile ? 80 : 120
      const viewportHeight = window.innerHeight - controlsHeight

      // Calculate zoom to fit cluster with padding
      const zoomToFitWidth = viewportWidth / (clusterWidth * 1.3)
      const zoomToFitHeight = viewportHeight / (clusterHeight * 1.3)
      const idealZoom = Math.min(zoomToFitWidth, zoomToFitHeight)

      // Clamp to reasonable range and apply
      const targetZoom = Math.max(MIN_ZOOM, Math.min(0.6, idealZoom))
      const targetPercent = zoomToPercent(targetZoom)

      // Apply zoom to fit the filtered items
      setZoomPercent(targetPercent)
      canvasRef.current?.setZoom(targetZoom)
    }
  }, [selectedCategory, filteredIndices.size])

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
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        categories={categories}
        zoomPercent={zoomPercent}
        onZoomChange={handleZoomChange}
        onRandomConcept={handleRandomConcept}
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
