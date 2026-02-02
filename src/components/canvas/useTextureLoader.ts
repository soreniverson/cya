'use client'

import { useRef, useCallback } from 'react'
import { Texture, Assets } from 'pixi.js'
import { getCategoryColor } from './canvas-utils'

// Configuration
const MAX_TEXTURE_COUNT = 150 // Maximum textures in cache before eviction
const EVICTION_BATCH_SIZE = 30 // Remove this many when over limit
const MAX_CONCURRENT_LOADS = 6 // Total concurrent loads

export interface TextureLoader {
  getTexture: (url: string) => Texture | null
  requestLoad: (url: string, priority: number) => void
  processQueue: () => void
  getCategoryColor: (category: string | null) => number
  clearQueue: () => void
  hasPendingLoads: () => boolean
}

interface CacheEntry {
  texture: Texture
  lastUsed: number
}

export function useTextureLoader(): TextureLoader {
  // LRU cache with metadata
  const textureCache = useRef<Map<string, CacheEntry>>(new Map())
  const loadingSet = useRef<Set<string>>(new Set())
  const loadQueueMap = useRef<Map<string, number>>(new Map()) // url -> priority
  const activeLoads = useRef<number>(0)
  const frameCount = useRef<number>(0)

  // Evict least recently used textures when cache is too large
  const evictIfNeeded = useCallback(() => {
    const cache = textureCache.current
    if (cache.size <= MAX_TEXTURE_COUNT) return

    // Sort by lastUsed (oldest first)
    const entries = Array.from(cache.entries())
    entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed)

    // Evict oldest entries
    const toEvict = entries.slice(0, EVICTION_BATCH_SIZE)

    for (const [url, entry] of toEvict) {
      entry.texture.destroy(true)
      cache.delete(url)
    }
  }, [])

  const getTexture = useCallback((url: string): Texture | null => {
    const entry = textureCache.current.get(url)
    if (entry) {
      // Update last used time (LRU tracking)
      entry.lastUsed = Date.now()
      return entry.texture
    }
    return null
  }, [])

  const loadTexture = useCallback(async (url: string) => {
    if (textureCache.current.has(url) || loadingSet.current.has(url)) {
      return
    }

    loadingSet.current.add(url)
    activeLoads.current++

    try {
      const texture = await Assets.load<Texture>(url)

      textureCache.current.set(url, {
        texture,
        lastUsed: Date.now(),
      })

      // Check if we need to evict
      evictIfNeeded()
    } catch (error) {
      // Silently fail - will show placeholder
      console.warn('Failed to load:', url)
    } finally {
      loadingSet.current.delete(url)
      activeLoads.current--
    }
  }, [evictIfNeeded])

  const processQueue = useCallback(() => {
    frameCount.current++

    if (loadQueueMap.current.size === 0) return

    // Only process every 10 frames to reduce overhead
    if (frameCount.current % 10 !== 0 && activeLoads.current >= MAX_CONCURRENT_LOADS / 2) {
      return
    }

    // Convert to array and sort by priority
    const toProcess = Array.from(loadQueueMap.current.entries())
    toProcess.sort((a, b) => a[1] - b[1]) // Sort by priority (lower = higher priority)

    // Process up to 4 per frame
    let processed = 0
    for (const [url] of toProcess) {
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
