'use client'

import { useRef, useCallback } from 'react'
import { Texture, Assets } from 'pixi.js'
import { MAX_CONCURRENT_LOADS, getCategoryColor } from './canvas-utils'

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
  // Use Map for O(1) lookup instead of array.find() which is O(n)
  const loadQueueMap = useRef<Map<string, number>>(new Map()) // url -> priority
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

    if (loadQueueMap.current.size === 0) return

    // Only sort and process every 15 frames to reduce overhead during fast movement
    if (frameCount.current % 15 !== 0 && activeLoads.current >= MAX_CONCURRENT_LOADS / 2) {
      return
    }

    // Convert to array and sort by priority
    const toProcess = Array.from(loadQueueMap.current.entries())
    toProcess.sort((a, b) => a[1] - b[1]) // Sort by priority (lower = higher priority)

    // Process up to 4 per frame to avoid stutter
    let processed = 0
    for (const [url, _priority] of toProcess) {
      if (activeLoads.current >= MAX_CONCURRENT_LOADS || processed >= 4) break

      if (textureCache.current.has(url) || loadingSet.current.has(url)) {
        loadQueueMap.current.delete(url)
        continue
      }

      loadQueueMap.current.delete(url)
      loadTexture(url)
      processed++
    }
  }, [loadTexture])

  const requestLoad = useCallback((url: string, priority: number) => {
    // Already have it or loading it
    if (textureCache.current.has(url)) return
    if (loadingSet.current.has(url)) return

    // O(1) check and update
    const existing = loadQueueMap.current.get(url)
    if (existing !== undefined) {
      // Update priority if better (lower = higher priority)
      if (priority < existing) {
        loadQueueMap.current.set(url, priority)
      }
      return
    }

    loadQueueMap.current.set(url, priority)
  }, [])

  const clearQueue = useCallback(() => {
    loadQueueMap.current.clear()
  }, [])

  const hasPendingLoads = useCallback(() => {
    return loadQueueMap.current.size > 0 || activeLoads.current > 0
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
