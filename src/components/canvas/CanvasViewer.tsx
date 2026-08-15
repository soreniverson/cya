'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import type { CanvasConcept, Category } from '@/lib/types'
import { PixiCanvas, type PixiCanvasHandle } from './PixiCanvas'
import { CanvasControls } from './CanvasControls'
import { ConceptLightbox } from './ConceptLightbox'
import { percentToZoom, zoomToPercent, DEFAULT_ZOOM, MIN_ZOOM, CELL_SIZE } from './canvas-utils'

interface CanvasViewerProps {
  concepts: CanvasConcept[]
  categories: Category[]
}

export function CanvasViewer({ concepts, categories }: CanvasViewerProps) {
  const canvasRef = useRef<PixiCanvasHandle>(null)

  // Filter state
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // Zoom state (for slider sync)
  const [zoomPercent, setZoomPercent] = useState(zoomToPercent(DEFAULT_ZOOM))

  // Lightbox state
  const [selectedConcept, setSelectedConcept] = useState<CanvasConcept | null>(null)

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
    if (!selectedCategory || filteredIndices.size === 0) return

    // Calculate zoom needed to fit all filtered items
    const count = filteredIndices.size
    const cols = Math.ceil(Math.sqrt(count * 1.5))
    const rows = Math.ceil(count / cols)

    // Estimate cluster size in pixels
    const clusterWidth = cols * CELL_SIZE
    const clusterHeight = rows * CELL_SIZE

    // Get viewport size (use window as approximation)
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight - 120 // Account for controls

    // Calculate zoom to fit cluster with padding
    const zoomToFitWidth = viewportWidth / (clusterWidth * 1.2)
    const zoomToFitHeight = viewportHeight / (clusterHeight * 1.2)
    const idealZoom = Math.min(zoomToFitWidth, zoomToFitHeight)

    // Clamp to reasonable range and apply
    const targetZoom = Math.max(MIN_ZOOM, Math.min(0.5, idealZoom))
    const targetPercent = zoomToPercent(targetZoom)

    // Read live zoom from the canvas rather than the `zoomPercent` state: the
    // state is not in this effect's dependencies, so it would be stale. Driving
    // the canvas imperatively also avoids a setState cascade here - the canvas
    // reports the new zoom back through onZoomChange as it animates.
    const currentPercent = canvasRef.current?.getZoomPercent() ?? zoomToPercent(DEFAULT_ZOOM)

    // Only zoom out if current zoom would cut off items
    if (currentPercent > targetPercent + 5) {
      canvasRef.current?.setZoom(targetZoom)
    }
  }, [selectedCategory, filteredIndices.size])

  // Handlers
  const handleCardClick = useCallback((concept: CanvasConcept) => {
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
      />

      {/* Lightbox */}
      <ConceptLightbox
        concept={selectedConcept}
        onClose={() => setSelectedConcept(null)}
      />
    </div>
  )
}
