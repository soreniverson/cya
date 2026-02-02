'use client'

import { useRef, useState, useCallback, useMemo } from 'react'
import type { Concept } from '@/lib/types'
import {
  computeGridConfig,
  getGridCenter,
  getRandomGridPosition,
  easeOutCubic,
  type Camera,
  type GridConfig,
} from './canvas-utils'

export interface AnimationTarget {
  startCamera: Camera
  endCamera: Camera
  startZoom: number
  endZoom: number
  startTime: number
  duration: number
}

export interface CanvasState {
  // Refs for high-frequency updates (no re-renders)
  cameraRef: React.MutableRefObject<Camera>
  zoomRef: React.MutableRefObject<number>
  velocityRef: React.MutableRefObject<Camera>
  animationTargetRef: React.MutableRefObject<AnimationTarget | null>

  // React state for UI sync (throttled)
  zoomPercent: number
  setZoomPercent: (percent: number) => void

  // Grid configuration
  gridConfig: GridConfig
  concepts: Concept[]

  // Filter state
  searchQuery: string
  setSearchQuery: (query: string) => void
  selectedCategory: string | null
  setSelectedCategory: (category: string | null) => void
  filteredIndices: Set<number>

  // Lightbox state
  selectedConcept: Concept | null
  setSelectedConcept: (concept: Concept | null) => void

  // Animation controls
  animateToPosition: (target: Camera, duration?: number) => void
  shuffle: () => void
  recenter: () => void

  // Sync zoom from ref to state
  syncZoomToState: () => void
}

export function useCanvasState(concepts: Concept[]): CanvasState {
  const gridConfig = useMemo(() => computeGridConfig(concepts.length), [concepts.length])

  // Initialize camera at grid center
  const initialCamera = useMemo(() => getGridCenter(gridConfig), [gridConfig])

  // High-frequency refs
  const cameraRef = useRef<Camera>(initialCamera)
  const zoomRef = useRef<number>(0.5)
  const velocityRef = useRef<Camera>({ x: 0, y: 0 })
  const animationTargetRef = useRef<AnimationTarget | null>(null)

  // React state for UI
  const [zoomPercent, setZoomPercentState] = useState(50)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null)

  // Compute filtered indices based on search/category
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

  const setZoomPercent = useCallback((percent: number) => {
    setZoomPercentState(percent)
    // Convert percent (0-100) to zoom (0.05-2)
    zoomRef.current = 0.05 + (percent / 100) * 1.95
  }, [])

  const syncZoomToState = useCallback(() => {
    // Convert zoom (0.05-2) to percent (0-100)
    const percent = Math.round(((zoomRef.current - 0.05) / 1.95) * 100)
    setZoomPercentState(percent)
  }, [])

  const animateToPosition = useCallback((target: Camera, duration = 800) => {
    // Cancel any momentum
    velocityRef.current = { x: 0, y: 0 }

    animationTargetRef.current = {
      startCamera: { ...cameraRef.current },
      endCamera: target,
      startZoom: zoomRef.current,
      endZoom: zoomRef.current,
      startTime: performance.now(),
      duration,
    }
  }, [])

  const shuffle = useCallback(() => {
    const randomPos = getRandomGridPosition(gridConfig)
    animateToPosition(randomPos, 1000)
  }, [gridConfig, animateToPosition])

  const recenter = useCallback(() => {
    const center = getGridCenter(gridConfig)
    animateToPosition(center, 800)
  }, [gridConfig, animateToPosition])

  return {
    cameraRef,
    zoomRef,
    velocityRef,
    animationTargetRef,
    zoomPercent,
    setZoomPercent,
    gridConfig,
    concepts,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    filteredIndices,
    selectedConcept,
    setSelectedConcept,
    animateToPosition,
    shuffle,
    recenter,
    syncZoomToState,
  }
}

// Helper to update animation (call in render loop)
export function updateAnimation(state: CanvasState): boolean {
  const target = state.animationTargetRef.current
  if (!target) return false

  const elapsed = performance.now() - target.startTime
  const progress = Math.min(elapsed / target.duration, 1)
  const eased = easeOutCubic(progress)

  state.cameraRef.current = {
    x: target.startCamera.x + (target.endCamera.x - target.startCamera.x) * eased,
    y: target.startCamera.y + (target.endCamera.y - target.startCamera.y) * eased,
  }

  state.zoomRef.current =
    target.startZoom + (target.endZoom - target.startZoom) * eased

  if (progress >= 1) {
    state.animationTargetRef.current = null
  }

  return true
}
