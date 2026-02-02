'use client'

import { useRef, useEffect, useCallback } from 'react'
import type { Concept, Category } from '@/lib/types'
import { useCanvasState, updateAnimation } from './useCanvasState'
import { useImageLoader } from './useImageLoader'
import { useCanvasRenderer } from './useCanvasRenderer'
import { useCanvasInteractions } from './useCanvasInteractions'
import { CanvasControls } from './CanvasControls'
import { ConceptLightbox } from './ConceptLightbox'
import { hitTestCard } from './canvas-utils'

interface CanvasViewerProps {
  concepts: Concept[]
  categories: Category[]
}

export function CanvasViewer({ concepts, categories }: CanvasViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animationFrameRef = useRef<number>(0)
  const hoveredIndexRef = useRef<number | null>(null)

  const state = useCanvasState(concepts)
  const imageLoader = useImageLoader()
  const renderer = useCanvasRenderer(state, imageLoader)
  const interactions = useCanvasInteractions(state, canvasRef)

  // Set up canvas size and handle resize
  const updateCanvasSize = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
    }
  }, [])

  // Initialize canvas and bind interactions
  useEffect(() => {
    updateCanvasSize()

    const canvas = canvasRef.current
    if (canvas) {
      interactions.bind(canvas)
    }

    const handleResize = () => {
      updateCanvasSize()
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [updateCanvasSize, interactions])

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const animate = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Update animation state
      const isAnimating = updateAnimation(state)
      const hasMomentum = interactions.updateMomentum()

      // Get viewport size
      const dpr = window.devicePixelRatio || 1
      const viewportWidth = canvas.width / dpr
      const viewportHeight = canvas.height / dpr

      // Render
      renderer.render(ctx, viewportWidth, viewportHeight, hoveredIndexRef.current)

      // Sync zoom to state if animating
      if (isAnimating) {
        state.syncZoomToState()
      }

      // Continue animation loop
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameRef.current)
    }
  }, [state, renderer, interactions])

  // Update hovered index from interactions
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const dpr = window.devicePixelRatio || 1
      const viewportWidth = canvas.width / dpr
      const viewportHeight = canvas.height / dpr

      const hit = hitTestCard(
        x,
        y,
        state.cameraRef.current,
        state.zoomRef.current,
        viewportWidth,
        viewportHeight,
        state.gridConfig,
        state.concepts
      )
      hoveredIndexRef.current = hit?.index ?? null
    }

    canvas.addEventListener('mousemove', handleMouseMove)
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove)
    }
  }, [state])

  // Handle keyboard shortcuts for lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.selectedConcept) {
        state.setSelectedConcept(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen overflow-hidden bg-background"
    >
      <canvas
        ref={canvasRef}
        className="block cursor-grab active:cursor-grabbing touch-none"
      />

      <CanvasControls
        searchQuery={state.searchQuery}
        onSearchChange={state.setSearchQuery}
        selectedCategory={state.selectedCategory}
        onCategoryChange={state.setSelectedCategory}
        categories={categories}
        zoomPercent={state.zoomPercent}
        onZoomChange={state.setZoomPercent}
        onShuffle={state.shuffle}
        onRecenter={state.recenter}
        filteredCount={state.filteredIndices.size}
        totalCount={concepts.length}
      />

      <ConceptLightbox
        concept={state.selectedConcept}
        onClose={() => state.setSelectedConcept(null)}
      />
    </div>
  )
}
