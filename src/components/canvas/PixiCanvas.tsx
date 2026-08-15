'use client'

import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { Application } from 'pixi.js'
import type { CanvasConcept } from '@/lib/types'
import { useViewport } from './useViewport'
import { useTextureLoader } from './useTextureLoader'
import { useSpritePool } from './useSpritePool'
import {
  computeGridConfig,
  getVisibleCards,
  hitTestCard,
  COLORS,
  zoomToPercent,
  type Viewport,
  type VisibleCard,
} from './canvas-utils'

export interface PixiCanvasHandle {
  shuffle: () => void
  recenter: () => void
  setZoom: (zoom: number) => void
  getZoomPercent: () => number
}

interface PixiCanvasProps {
  concepts: CanvasConcept[]
  filteredIndices: Set<number>
  isClusterMode: boolean  // true = cluster matching cards in center (text search only)
  onCardClick: (concept: CanvasConcept) => void
  onZoomChange?: (percent: number) => void
}

// Reusable visible cards array to avoid allocation
let visibleCardsCache: VisibleCard[] = []
let lastViewportHash = ''

function getViewportHash(vp: Viewport): string {
  // Round to reduce unnecessary recalculations
  return `${Math.round(vp.pan.x)},${Math.round(vp.pan.y)},${vp.zoom.toFixed(3)},${vp.width},${vp.height}`
}

export const PixiCanvas = forwardRef<PixiCanvasHandle, PixiCanvasProps>(
  function PixiCanvas({ concepts, filteredIndices, isClusterMode, onCardClick, onZoomChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const appRef = useRef<Application | null>(null)
    const rafRef = useRef<number>(0)
    const isRunningRef = useRef(false)
    const hoveredIndexRef = useRef<number | null>(null)
    const isDraggingRef = useRef(false)
    const hasDraggedRef = useRef(false)
    const lastZoomPercentRef = useRef<number>(-1)
    const zoomThrottleRef = useRef<number>(0)
    const tickRef = useRef<() => void>(() => {})
    // Set in the init effect - calling Date.now() during render is impure.
    const mountTimeRef = useRef(0) // Track mount time for click prevention

    // Memoize gridConfig to prevent useViewport from resetting on every render
    const gridConfig = useMemo(() => computeGridConfig(concepts.length), [concepts.length])
    const viewport = useViewport(gridConfig)
    const textureLoader = useTextureLoader()
    const spritePool = useSpritePool()

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      shuffle: viewport.shuffle,
      recenter: viewport.recenter,
      setZoom: viewport.setZoom,
      getZoomPercent: () => zoomToPercent(viewport.getViewport().zoom),
    }), [viewport])

    // Render function with caching
    const render = useCallback((forceRecalc = false): boolean => {
      const app = appRef.current
      if (!app) return false

      const vp = viewport.getViewport()
      const hash = getViewportHash(vp)

      // Only recalculate visible cards if viewport changed significantly
      if (forceRecalc || hash !== lastViewportHash) {
        visibleCardsCache = getVisibleCards(vp, gridConfig, concepts)
        lastViewportHash = hash
      }

      const stillAnimating = spritePool.update(
        visibleCardsCache,
        vp,
        textureLoader,
        filteredIndices,
        hoveredIndexRef.current,
        concepts,
        isClusterMode,
        gridConfig
      )

      app.render()
      return stillAnimating
    }, [viewport, gridConfig, concepts, spritePool, textureLoader, filteredIndices, isClusterMode])

    // Animation loop with throttled zoom callback
    const tick = useCallback(() => {
      const viewportAnimating = viewport.tick()
      const spritesAnimating = render()

      // Throttle zoom change callbacks (every 100ms max)
      const now = Date.now()
      if (onZoomChange && now - zoomThrottleRef.current > 100) {
        const newPercent = zoomToPercent(viewport.getViewport().zoom)
        if (newPercent !== lastZoomPercentRef.current) {
          lastZoomPercentRef.current = newPercent
          onZoomChange(newPercent)
          zoomThrottleRef.current = now
        }
      }

      // Keep running while animating, dragging, sprites animating, OR images loading.
      // Recurse through tickRef, not `tick` directly: `tick` is a per-render
      // closure, so recursing on it pins the loop to the state it started with
      // and a filter change during image loading would never take effect.
      if (viewportAnimating || isDraggingRef.current || spritesAnimating || textureLoader.hasPendingLoads()) {
        rafRef.current = requestAnimationFrame(() => tickRef.current())
      } else {
        isRunningRef.current = false
        // Final zoom update when animation ends
        if (onZoomChange) {
          const finalPercent = zoomToPercent(viewport.getViewport().zoom)
          if (finalPercent !== lastZoomPercentRef.current) {
            lastZoomPercentRef.current = finalPercent
            onZoomChange(finalPercent)
          }
        }
      }
    }, [viewport, render, onZoomChange, textureLoader])

    // Keep tickRef pointing at the newest closure. The rAF loop calls
    // tickRef.current() rather than a captured `tick`, so every frame picks up
    // current props. Assigned in an effect, not during render.
    useEffect(() => {
      tickRef.current = tick
    }, [tick])

    // Start animation loop
    const ensureRunning = useCallback(() => {
      if (!isRunningRef.current) {
        isRunningRef.current = true
        rafRef.current = requestAnimationFrame(() => tickRef.current())
      }
    }, [])

    // Initialize PixiJS
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      let mounted = true

      const initApp = async () => {
        const app = new Application()

        await app.init({
          background: COLORS.background,
          resizeTo: container,
          antialias: false, // Faster without antialiasing
          resolution: Math.min(window.devicePixelRatio || 1, 2), // Cap at 2x for performance
          autoDensity: true,
          powerPreference: 'high-performance',
        })

        if (!mounted) {
          app.destroy(true)
          return
        }

        container.appendChild(app.canvas)

        // Initialize sprite pool with app reference
        spritePool.init(app)
        app.stage.addChild(spritePool.getContainer())

        appRef.current = app

        // Set initial size
        viewport.setSize(app.screen.width, app.screen.height)

        // Initial render and start the animation loop to load images
        lastViewportHash = '' // Force recalc
        render(true)

        // Start animation loop to process image loading queue
        // Use setTimeout to ensure tickRef is updated after this effect runs
        setTimeout(() => {
          if (!isRunningRef.current && appRef.current) {
            isRunningRef.current = true
            rafRef.current = requestAnimationFrame(() => tickRef.current())
          }
        }, 0)

      }

      initApp()

      // Reset mount time when effect runs
      mountTimeRef.current = Date.now()

      return () => {
        mounted = false
        cancelAnimationFrame(rafRef.current)

        if (appRef.current) {
          spritePool.cleanup()
          textureLoader.destroy()
          appRef.current.destroy(true)
          appRef.current = null
        }
      }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Textures now finish loading independently of the render loop (including
    // while the tab is in the background), so a completed load has to ask for a
    // repaint itself - otherwise it sits in the cache, undrawn.
    useEffect(() => {
      textureLoader.setOnTextureLoaded(() => ensureRunning())

      // Draining the queue was decoupled from requestAnimationFrame, but
      // *filling* it still is not: requestLoad is only called from
      // spritePool.update, which runs inside the render loop. So while rAF is
      // halted, anything already queued keeps downloading but newly-exposed
      // cards are never asked for. This ticks the render path on a timer so the
      // visible set keeps being evaluated even when rAF is not running.
      const keepAlive = window.setInterval(() => {
        if (document.visibilityState !== 'visible' && appRef.current) {
          render(true)
        }
      }, 1000)

      const handleVisibility = () => {
        // requestAnimationFrame is halted while hidden. On return, restart the
        // loop so everything fetched in the background gets painted.
        if (document.visibilityState === 'visible') ensureRunning()
      }
      document.addEventListener('visibilitychange', handleVisibility)
      return () => {
        window.clearInterval(keepAlive)
        textureLoader.setOnTextureLoaded(null)
        document.removeEventListener('visibilitychange', handleVisibility)
      }
    }, [textureLoader, ensureRunning, render])

    // Handle resize
    useEffect(() => {
      const handleResize = () => {
        const app = appRef.current
        if (!app) return

        viewport.setSize(app.screen.width, app.screen.height)
        lastViewportHash = '' // Force recalc
        render(true)
      }

      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }, [viewport, render])

    // Bind pointer events
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const handlePointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return

        isDraggingRef.current = true
        hasDraggedRef.current = false
        viewport.onDragStart(e.clientX, e.clientY)
        ensureRunning()

        container.setPointerCapture(e.pointerId)
      }

      const handlePointerMove = (e: PointerEvent) => {
        const app = appRef.current
        if (!app) return

        // Handle drag first (more common during interaction)
        if (isDraggingRef.current) {
          hasDraggedRef.current = true
          viewport.onDragMove(e.clientX, e.clientY)
          container.style.cursor = 'grabbing'
          return
        }

        // Hit test for hover (throttle this)
        const rect = container.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        const vp = viewport.getViewport()
        const hit = hitTestCard(x, y, vp, gridConfig, concepts)
        const newHoveredIndex = hit?.index ?? null

        if (newHoveredIndex !== hoveredIndexRef.current) {
          hoveredIndexRef.current = newHoveredIndex
          container.style.cursor = newHoveredIndex !== null ? 'pointer' : 'grab'
        }
      }

      const handlePointerUp = (e: PointerEvent) => {
        container.releasePointerCapture(e.pointerId)

        if (isDraggingRef.current) {
          isDraggingRef.current = false
          viewport.onDragEnd()

          // Only allow clicks after 500ms from mount (prevents accidental clicks on page load)
          const timeSinceMount = Date.now() - mountTimeRef.current
          if (!hasDraggedRef.current && timeSinceMount > 500) {
            const rect = container.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top

            const vp = viewport.getViewport()
            const hit = hitTestCard(x, y, vp, gridConfig, concepts)

            if (hit) {
              onCardClick(hit.concept)
            }
          }

          container.style.cursor = hoveredIndexRef.current !== null ? 'pointer' : 'grab'
        }
      }

      const handleWheel = (e: WheelEvent) => {
        e.preventDefault()

        const rect = container.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        viewport.onWheel(e.deltaY, x, y)
        ensureRunning()
      }

      // Touch handlers
      let lastTouchDistance = 0

      const getTouchDistance = (touches: TouchList): number => {
        if (touches.length < 2) return 0
        const dx = touches[0].clientX - touches[1].clientX
        const dy = touches[0].clientY - touches[1].clientY
        return Math.sqrt(dx * dx + dy * dy)
      }

      const getTouchCenter = (touches: TouchList) => {
        if (touches.length < 2) return { x: 0, y: 0 }
        const rect = container.getBoundingClientRect()
        return {
          x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
          y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top,
        }
      }

      const handleTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          e.preventDefault()
          lastTouchDistance = getTouchDistance(e.touches)
          viewport.onPinchStart(lastTouchDistance)
          ensureRunning()
        }
      }

      const handleTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          e.preventDefault()
          const distance = getTouchDistance(e.touches)
          const center = getTouchCenter(e.touches)
          viewport.onPinchMove(distance, center.x, center.y)
        }
      }

      const handleTouchEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) {
          viewport.onPinchEnd()
        }
      }

      container.addEventListener('pointerdown', handlePointerDown)
      container.addEventListener('pointermove', handlePointerMove)
      container.addEventListener('pointerup', handlePointerUp)
      container.addEventListener('pointerleave', handlePointerUp)
      container.addEventListener('wheel', handleWheel, { passive: false })
      container.addEventListener('touchstart', handleTouchStart, { passive: false })
      container.addEventListener('touchmove', handleTouchMove, { passive: false })
      container.addEventListener('touchend', handleTouchEnd)

      return () => {
        container.removeEventListener('pointerdown', handlePointerDown)
        container.removeEventListener('pointermove', handlePointerMove)
        container.removeEventListener('pointerup', handlePointerUp)
        container.removeEventListener('pointerleave', handlePointerUp)
        container.removeEventListener('wheel', handleWheel)
        container.removeEventListener('touchstart', handleTouchStart)
        container.removeEventListener('touchmove', handleTouchMove)
        container.removeEventListener('touchend', handleTouchEnd)
      }
    }, [viewport, gridConfig, concepts, onCardClick, ensureRunning])

    // Re-render when filter/search changes
    useEffect(() => {
      // Force recalc and start animation loop
      lastViewportHash = '' // Invalidate cache
      if (appRef.current) {
        render(true)
        ensureRunning()
      }
    }, [filteredIndices, isClusterMode, render, ensureRunning])

    return (
      <div
        ref={containerRef}
        className="w-full h-full cursor-grab touch-none"
        style={{ touchAction: 'none' }}
        role="application"
        aria-label={`Infinite canvas of ${concepts.length} concepts. Drag to pan, scroll to zoom, click a concept to open it. A text list of every concept is available below.`}
      />
    )
  }
)
