'use client'

import { useRef, useCallback, useEffect } from 'react'
import type { CanvasState } from './useCanvasState'
import {
  hitTestCard,
  clampZoom,
  zoomTowardPoint,
  FRICTION,
  VELOCITY_THRESHOLD,
  type Camera,
  type CardHit,
} from './canvas-utils'

const CLICK_THRESHOLD = 5
const VELOCITY_SAMPLES = 5
const ZOOM_FACTOR = 1.1

export interface CanvasInteractions {
  hoveredIndex: number | null
  bind: (canvas: HTMLCanvasElement | null) => void
  updateMomentum: () => boolean
}

interface DragState {
  isDragging: boolean
  startX: number
  startY: number
  lastX: number
  lastY: number
  hasMoved: boolean
  velocitySamples: Array<{ dx: number; dy: number; time: number }>
}

interface PinchState {
  isPinching: boolean
  initialDistance: number
  initialZoom: number
  centerX: number
  centerY: number
}

export function useCanvasInteractions(
  state: CanvasState,
  canvasRef: React.RefObject<HTMLCanvasElement | null>
): CanvasInteractions {
  const hoveredIndexRef = useRef<number | null>(null)
  const dragStateRef = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    hasMoved: false,
    velocitySamples: [],
  })
  const pinchStateRef = useRef<PinchState>({
    isPinching: false,
    initialDistance: 0,
    initialZoom: 1,
    centerX: 0,
    centerY: 0,
  })

  const getViewportSize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return { width: 0, height: 0 }
    return {
      width: canvas.width / (window.devicePixelRatio || 1),
      height: canvas.height / (window.devicePixelRatio || 1),
    }
  }, [canvasRef])

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0) return // Only left click

      const canvas = canvasRef.current
      if (!canvas) return

      canvas.setPointerCapture(e.pointerId)

      dragStateRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        hasMoved: false,
        velocitySamples: [],
      }

      // Cancel any ongoing animation
      state.animationTargetRef.current = null
      state.velocityRef.current = { x: 0, y: 0 }
    },
    [canvasRef, state]
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const viewport = getViewportSize()

      // Update hover state
      const hit = hitTestCard(
        x,
        y,
        state.cameraRef.current,
        state.zoomRef.current,
        viewport.width,
        viewport.height,
        state.gridConfig,
        state.concepts
      )
      hoveredIndexRef.current = hit?.index ?? null

      // Handle dragging
      const drag = dragStateRef.current
      if (drag.isDragging) {
        const dx = e.clientX - drag.lastX
        const dy = e.clientY - drag.lastY

        // Check if we've moved enough to count as a drag
        const totalDx = e.clientX - drag.startX
        const totalDy = e.clientY - drag.startY
        if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > CLICK_THRESHOLD) {
          drag.hasMoved = true
        }

        // Move camera
        state.cameraRef.current.x -= dx / state.zoomRef.current
        state.cameraRef.current.y -= dy / state.zoomRef.current

        // Track velocity samples
        const now = performance.now()
        drag.velocitySamples.push({ dx, dy, time: now })
        if (drag.velocitySamples.length > VELOCITY_SAMPLES) {
          drag.velocitySamples.shift()
        }

        drag.lastX = e.clientX
        drag.lastY = e.clientY
      }
    },
    [canvasRef, getViewportSize, state]
  )

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.releasePointerCapture(e.pointerId)

      const drag = dragStateRef.current
      if (!drag.isDragging) return

      drag.isDragging = false

      // Calculate momentum velocity from samples
      if (drag.velocitySamples.length >= 2) {
        let totalDx = 0
        let totalDy = 0
        for (const sample of drag.velocitySamples) {
          totalDx += sample.dx
          totalDy += sample.dy
        }
        const avgDx = totalDx / drag.velocitySamples.length
        const avgDy = totalDy / drag.velocitySamples.length

        state.velocityRef.current = {
          x: avgDx * 10,
          y: avgDy * 10,
        }
      }

      // Handle click if we didn't move much
      if (!drag.hasMoved) {
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const viewport = getViewportSize()

        const hit = hitTestCard(
          x,
          y,
          state.cameraRef.current,
          state.zoomRef.current,
          viewport.width,
          viewport.height,
          state.gridConfig,
          state.concepts
        )

        if (hit) {
          state.setSelectedConcept(hit.concept)
        }
      }
    },
    [canvasRef, getViewportSize, state]
  )

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()

      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const viewport = getViewportSize()

      // Determine zoom direction
      const delta = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
      const newZoom = clampZoom(state.zoomRef.current * delta)

      // Zoom toward cursor
      const newCamera = zoomTowardPoint(
        state.cameraRef.current,
        state.zoomRef.current,
        newZoom,
        mouseX,
        mouseY,
        viewport.width,
        viewport.height
      )

      state.cameraRef.current = newCamera
      state.zoomRef.current = newZoom
      state.syncZoomToState()

      // Cancel any animation
      state.animationTargetRef.current = null
    },
    [canvasRef, getViewportSize, state]
  )

  // Touch handlers for pinch zoom
  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault()

        const touch1 = e.touches[0]
        const touch2 = e.touches[1]
        const dx = touch1.clientX - touch2.clientX
        const dy = touch1.clientY - touch2.clientY
        const distance = Math.sqrt(dx * dx + dy * dy)

        pinchStateRef.current = {
          isPinching: true,
          initialDistance: distance,
          initialZoom: state.zoomRef.current,
          centerX: (touch1.clientX + touch2.clientX) / 2,
          centerY: (touch1.clientY + touch2.clientY) / 2,
        }

        // Cancel any animation
        state.animationTargetRef.current = null
        state.velocityRef.current = { x: 0, y: 0 }
      }
    },
    [state]
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      const pinch = pinchStateRef.current
      if (!pinch.isPinching || e.touches.length !== 2) return

      e.preventDefault()

      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const dx = touch1.clientX - touch2.clientX
      const dy = touch1.clientY - touch2.clientY
      const distance = Math.sqrt(dx * dx + dy * dy)

      const scale = distance / pinch.initialDistance
      const newZoom = clampZoom(pinch.initialZoom * scale)

      const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left
      const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top
      const viewport = getViewportSize()

      // Zoom toward pinch center
      const newCamera = zoomTowardPoint(
        state.cameraRef.current,
        state.zoomRef.current,
        newZoom,
        centerX,
        centerY,
        viewport.width,
        viewport.height
      )

      state.cameraRef.current = newCamera
      state.zoomRef.current = newZoom
      state.syncZoomToState()
    },
    [canvasRef, getViewportSize, state]
  )

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (e.touches.length < 2) {
      pinchStateRef.current.isPinching = false
    }
  }, [])

  const bind = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return

      canvas.addEventListener('pointerdown', handlePointerDown)
      canvas.addEventListener('pointermove', handlePointerMove)
      canvas.addEventListener('pointerup', handlePointerUp)
      canvas.addEventListener('pointerleave', handlePointerUp)
      canvas.addEventListener('wheel', handleWheel, { passive: false })
      canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
      canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
      canvas.addEventListener('touchend', handleTouchEnd)

      return () => {
        canvas.removeEventListener('pointerdown', handlePointerDown)
        canvas.removeEventListener('pointermove', handlePointerMove)
        canvas.removeEventListener('pointerup', handlePointerUp)
        canvas.removeEventListener('pointerleave', handlePointerUp)
        canvas.removeEventListener('wheel', handleWheel)
        canvas.removeEventListener('touchstart', handleTouchStart)
        canvas.removeEventListener('touchmove', handleTouchMove)
        canvas.removeEventListener('touchend', handleTouchEnd)
      }
    },
    [
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleWheel,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
    ]
  )

  const updateMomentum = useCallback((): boolean => {
    const velocity = state.velocityRef.current
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y)

    if (speed < VELOCITY_THRESHOLD) {
      state.velocityRef.current = { x: 0, y: 0 }
      return false
    }

    // Apply velocity to camera
    state.cameraRef.current.x -= velocity.x / state.zoomRef.current
    state.cameraRef.current.y -= velocity.y / state.zoomRef.current

    // Apply friction
    state.velocityRef.current.x *= FRICTION
    state.velocityRef.current.y *= FRICTION

    return true
  }, [state])

  return {
    hoveredIndex: hoveredIndexRef.current,
    bind,
    updateMomentum,
  }
}
