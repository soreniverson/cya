'use client'

import { useRef, useCallback } from 'react'
import { Texture, Assets } from 'pixi.js'
import { MAX_CONCURRENT_LOADS, getCategoryColor } from './canvas-utils'

interface LoadRequest {
  url: string
  priority: number // squared distance from center
}

export interface TextureLoader {
  getTexture: (url: string) => Texture | null
  requestLoad: (url: string, priority: number) => void
  processQueue: () => void
  getCategoryColor: (category: string | null) => number
  clearQueue: () => void
  hasPendingLoads: () => boolean
}

export function useTextureLoader(): TextureLoader {
  const textureCache = useRef<Map<string, Texture>>(new Map())
  const loadingSet = useRef<Set<string>>(new Set())
  const loadQueue = useRef<LoadRequest[]>([])
  const activeLoads = useRef<number>(0)
  const frameCount = useRef<number>(0)

  const getTexture = useCallback((url: string): Texture | null => {
    return textureCache.current.get(url) ?? null
  }, [])

  const loadTexture = useCallback(async (url: string) => {
    if (textureCache.current.has(url) || loadingSet.current.has(url)) {
      return
    }

    loadingSet.current.add(url)
    activeLoads.current++

    try {
      const texture = await Assets.load<Texture>(url)
      textureCache.current.set(url, texture)
    } catch (error) {
      // Silently fail - will show placeholder
      console.warn('Failed to load:', url)
    } finally {
      loadingSet.current.delete(url)
      activeLoads.current--
    }
  }, [])

  const processQueue = useCallback(() => {
    frameCount.current++

    // Only sort every 10 frames to reduce overhead
    if (frameCount.current % 10 === 0 && loadQueue.current.length > 1) {
      loadQueue.current.sort((a, b) => a.priority - b.priority)
    }

    // Process up to max concurrent loads
    let processed = 0
    while (activeLoads.current < MAX_CONCURRENT_LOADS && loadQueue.current.length > 0 && processed < 6) {
      const request = loadQueue.current.shift()
      if (!request) break

      if (textureCache.current.has(request.url) || loadingSet.current.has(request.url)) {
        continue
      }

      loadTexture(request.url)
      processed++
    }
  }, [loadTexture])

  const requestLoad = useCallback((url: string, priority: number) => {
    // Already have it
    if (textureCache.current.has(url)) return
    if (loadingSet.current.has(url)) return

    // Check if already in queue
    const existing = loadQueue.current.find(r => r.url === url)
    if (existing) {
      // Update priority if better
      if (priority < existing.priority) {
        existing.priority = priority
      }
      return
    }

    loadQueue.current.push({ url, priority })
  }, [])

  const clearQueue = useCallback(() => {
    loadQueue.current = []
  }, [])

  const hasPendingLoads = useCallback(() => {
    return loadQueue.current.length > 0 || activeLoads.current > 0
  }, [])

  return {
    getTexture,
    requestLoad,
    processQueue,
    getCategoryColor,
    clearQueue,
    hasPendingLoads,
  }
}
