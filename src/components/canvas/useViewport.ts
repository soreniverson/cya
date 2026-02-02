'use client'

import { useRef, useCallback, useEffect } from 'react'
import {
  type Point,
  type Viewport,
  type GridConfig,
  clampZoom,
  zoomTowardPoint,
  easeOutCubic,
  getGridCenter,
  getRandomGridPosition,
  FRICTION,
  VELOCITY_STOP_THRESHOLD,
  DRAG_SAMPLE_WINDOW_MS,
  SHUFFLE_DURATION,
  RECENTER_DURATION,
  DEFAULT_ZOOM,
} from './canvas-utils'

interface DragSample {
  x: number
  y: number
  t: number
}

interface AnimationState {
  startPan: Point
  endPan: Point
  startZoom: number
  endZoom: number
  startTime: number
  duration: number
}

export interface ViewportState {
  // Current viewport (read these for rendering)
  getViewport: () => Viewport

  // Update viewport dimensions (call on resize)
  setSize: (width: number, height: number) => void

  // Interaction handlers
  onDragStart: (screenX: number, screenY: number) => void
  onDragMove: (screenX: number, screenY: number) => void
  onDragEnd: () => void
  onWheel: (deltaY: number, screenX: number, screenY: number) => void
  onPinchStart: (distance: number, centerX: number, centerY: number) => void
  onPinchMove: (distance: number, centerX: number, centerY: number) => void
  onPinchEnd: () => void

  // Zoom control (for slider)
  setZoom: (zoom: number) => void

  // Animated transitions
  shuffle: () => void
  recenter: () => void

  // Animation loop
  tick: () => boolean // Returns true if still animating
  isIdle: () => boolean
}

const ZOOM_WHEEL_FACTOR = 1.1

export function useViewport(gridConfig: GridConfig): ViewportState {
  // Core state (refs for performance - no re-renders)
  const panRef = useRef<Point>(getGridCenter(gridConfig))
  const zoomRef = useRef<number>(DEFAULT_ZOOM)
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })

  // Momentum state
  const velocityRef = useRef<Point>({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const dragSamplesRef = useRef<DragSample[]>([])
  const lastDragPosRef = useRef<Point>({ x: 0, y: 0 })

  // Pinch state
  const isPinchingRef = useRef(false)
  const pinchStartDistanceRef = useRef(0)
  const pinchStartZoomRef = useRef(1)

  // Animation state
  const animationRef = useRef<AnimationState | null>(null)

  // Initialize pan to grid center when gridConfig changes
  useEffect(() => {
    panRef.current = getGridCenter(gridConfig)
  }, [gridConfig])

  const getViewport = useCallback((): Viewport => ({
    pan: { ...panRef.current },
    zoom: zoomRef.current,
    width: sizeRef.current.width,
    height: sizeRef.current.height,
  }), [])

  const setSize = useCallback((width: number, height: number) => {
    sizeRef.current = { width, height }
  }, [])

  // Drag handlers
  const onDragStart = useCallback((screenX: number, screenY: number) => {
    isDraggingRef.current = true
    lastDragPosRef.current = { x: screenX, y: screenY }
    dragSamplesRef.current = [{ x: screenX, y: screenY, t: performance.now() }]

    // Cancel any ongoing animation or momentum
    animationRef.current = null
    velocityRef.current = { x: 0, y: 0 }
  }, [])

  const onDragMove = useCallback((screenX: number, screenY: number) => {
    if (!isDraggingRef.current) return

    const dx = screenX - lastDragPosRef.current.x
    const dy = screenY - lastDragPosRef.current.y

    // Move camera (opposite direction of drag)
    panRef.current.x -= dx / zoomRef.current
    panRef.current.y -= dy / zoomRef.current

    lastDragPosRef.current = { x: screenX, y: screenY }

    // Track samples for momentum
    const now = performance.now()
    dragSamplesRef.current.push({ x: screenX, y: screenY, t: now })

    // Keep only recent samples
    dragSamplesRef.current = dragSamplesRef.current.filter(
      s => now - s.t < DRAG_SAMPLE_WINDOW_MS * 2
    )
  }, [])

  const onDragEnd = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false

    // Calculate velocity from recent samples
    const now = performance.now()
    const recentSamples = dragSamplesRef.current.filter(
      s => now - s.t < DRAG_SAMPLE_WINDOW_MS
    )

    if (recentSamples.length >= 2) {
      const first = recentSamples[0]
      const last = recentSamples[recentSamples.length - 1]
      const dt = last.t - first.t

      if (dt > 0) {
        // Velocity in screen pixels per frame (assuming 60fps = 16.67ms per frame)
        const vx = ((last.x - first.x) / dt) * 16.67
        const vy = ((last.y - first.y) / dt) * 16.67

        velocityRef.current = { x: -vx, y: -vy }
      }
    }

    dragSamplesRef.current = []
  }, [])

  // Wheel zoom
  const onWheel = useCallback((deltaY: number, screenX: number, screenY: number) => {
    // Cancel any animation
    animationRef.current = null

    const factor = deltaY > 0 ? 1 / ZOOM_WHEEL_FACTOR : ZOOM_WHEEL_FACTOR
    const newZoom = clampZoom(zoomRef.current * factor)

    // Zoom toward cursor
    const newPan = zoomTowardPoint(
      panRef.current,
      zoomRef.current,
      newZoom,
      screenX,
      screenY,
      sizeRef.current.width,
      sizeRef.current.height
    )

    panRef.current = newPan
    zoomRef.current = newZoom
  }, [])

  // Pinch zoom
  const onPinchStart = useCallback((distance: number, centerX: number, centerY: number) => {
    isPinchingRef.current = true
    pinchStartDistanceRef.current = distance
    pinchStartZoomRef.current = zoomRef.current

    // Cancel any animation or momentum
    animationRef.current = null
    velocityRef.current = { x: 0, y: 0 }
  }, [])

  const onPinchMove = useCallback((distance: number, centerX: number, centerY: number) => {
    if (!isPinchingRef.current) return

    const scale = distance / pinchStartDistanceRef.current
    const newZoom = clampZoom(pinchStartZoomRef.current * scale)

    // Zoom toward pinch center
    const newPan = zoomTowardPoint(
      panRef.current,
      zoomRef.current,
      newZoom,
      centerX,
      centerY,
      sizeRef.current.width,
      sizeRef.current.height
    )

    panRef.current = newPan
    zoomRef.current = newZoom
  }, [])

  const onPinchEnd = useCallback(() => {
    isPinchingRef.current = false
  }, [])

  // Zoom from slider (zooms toward center)
  const setZoom = useCallback((zoom: number) => {
    const newZoom = clampZoom(zoom)
    const centerX = sizeRef.current.width / 2
    const centerY = sizeRef.current.height / 2

    const newPan = zoomTowardPoint(
      panRef.current,
      zoomRef.current,
      newZoom,
      centerX,
      centerY,
      sizeRef.current.width,
      sizeRef.current.height
    )

    panRef.current = newPan
    zoomRef.current = newZoom
  }, [])

  // Animated transitions
  const animateTo = useCallback((targetPan: Point, targetZoom: number, duration: number) => {
    // Cancel momentum
    velocityRef.current = { x: 0, y: 0 }

    animationRef.current = {
      startPan: { ...panRef.current },
      endPan: targetPan,
      startZoom: zoomRef.current,
      endZoom: targetZoom,
      startTime: performance.now(),
      duration,
    }
  }, [])

  const shuffle = useCallback(() => {
    const targetPan = getRandomGridPosition(gridConfig)
    animateTo(targetPan, zoomRef.current, SHUFFLE_DURATION)
  }, [gridConfig, animateTo])

  const recenter = useCallback(() => {
    const targetPan = getGridCenter(gridConfig)
    animateTo(targetPan, DEFAULT_ZOOM, RECENTER_DURATION)
  }, [gridConfig, animateTo])

  // Animation tick - returns true if still animating
  const tick = useCallback((): boolean => {
    let animating = false

    // Handle animated transition
    const anim = animationRef.current
    if (anim) {
      const now = performance.now()
      const elapsed = now - anim.startTime
      const t = Math.min(elapsed / anim.duration, 1)
      const ease = easeOutCubic(t)

      panRef.current = {
        x: anim.startPan.x + (anim.endPan.x - anim.startPan.x) * ease,
        y: anim.startPan.y + (anim.endPan.y - anim.startPan.y) * ease,
      }
      zoomRef.current = anim.startZoom + (anim.endZoom - anim.startZoom) * ease

      if (t >= 1) {
        animationRef.current = null
      } else {
        animating = true
      }
    }

    // Handle momentum
    const vel = velocityRef.current
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y)

    if (speed > VELOCITY_STOP_THRESHOLD) {
      panRef.current.x += vel.x / zoomRef.current
      panRef.current.y += vel.y / zoomRef.current

      vel.x *= FRICTION
      vel.y *= FRICTION

      animating = true
    } else if (speed > 0) {
      velocityRef.current = { x: 0, y: 0 }
    }

    return animating
  }, [])

  const isIdle = useCallback((): boolean => {
    const vel = velocityRef.current
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y)
    return !isDraggingRef.current && !isPinchingRef.current && !animationRef.current && speed <= VELOCITY_STOP_THRESHOLD
  }, [])

  return {
    getViewport,
    setSize,
    onDragStart,
    onDragMove,
    onDragEnd,
    onWheel,
    onPinchStart,
    onPinchMove,
    onPinchEnd,
    setZoom,
    shuffle,
    recenter,
    tick,
    isIdle,
  }
}
