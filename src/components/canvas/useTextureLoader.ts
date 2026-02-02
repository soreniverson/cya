'use client'

import { useRef, useCallback } from 'react'
import { Texture, Assets } from 'pixi.js'
import { getCategoryColor } from './canvas-utils'

// Configuration
const MAX_TEXTURE_COUNT = 150 // Maximum textures in cache before eviction
const EVICTION_BATCH_SIZE = 30 // Remove this many when over limit
const THUMB_CONCURRENT_LOADS = 8 // Concurrent loads for thumbnails
const MEDIUM_CONCURRENT_LOADS = 4 // Concurrent loads for medium images
const OFFSCREEN_DISPOSE_DELAY = 3000 // ms before disposing off-screen textures

export type ImageSize = 'thumb' | 'medium'

export interface TextureLoader {
  getTexture: (url: string) => Texture | null
  requestLoad: (url: string, priority: number, size: ImageSize) => void
  processQueue: () => void
  getCategoryColor: (category: string | null) => number
  clearQueue: () => void
  hasPendingLoads: () => boolean
  markVisible: (url: string) => void
  markOffscreen: (url: string) => void
  getStats: () => { cached: number; loading: number; queued: number }
}

interface CacheEntry {
  texture: Texture
  lastUsed: number
  size: ImageSize
}

interface QueueEntry {
  priority: number
  size: ImageSize
}

/**
 * Transform a Supabase storage URL to request a specific size
 * Uses Supabase's image transformation API
 */
function getResizedUrl(url: string, size: ImageSize): string {
  // Only transform Supabase URLs
  if (!url.includes('supabase.co/storage/v1/object/')) {
    return url
  }

  // Convert object URL to render URL for transformation
  // From: /storage/v1/object/public/bucket/file
  // To:   /storage/v1/render/image/public/bucket/file?width=X
  const renderUrl = url.replace(
    '/storage/v1/object/',
    '/storage/v1/render/image/'
  )

  const width = size === 'thumb' ? 200 : 500 // thumb: 200px, medium: 500px (plenty for 240px cards)
  const separator = renderUrl.includes('?') ? '&' : '?'
  return `${renderUrl}${separator}width=${width}&quality=80`
}

export function useTextureLoader(): TextureLoader {
  // LRU cache with metadata
  const textureCache = useRef<Map<string, CacheEntry>>(new Map())
  const loadingSet = useRef<Set<string>>(new Set())
  const loadQueueMap = useRef<Map<string, QueueEntry>>(new Map())
  const activeLoads = useRef<{ thumb: number; medium: number }>({ thumb: 0, medium: 0 })
  const frameCount = useRef<number>(0)

  // Off-screen disposal tracking
  const offscreenTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const visibleUrls = useRef<Set<string>>(new Set())

  // Evict least recently used textures when cache is too large
  const evictIfNeeded = useCallback(() => {
    const cache = textureCache.current
    if (cache.size <= MAX_TEXTURE_COUNT) return

    // Sort by lastUsed (oldest first)
    const entries = Array.from(cache.entries())
    entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed)

    // Don't evict currently visible textures
    const toEvict = entries
      .filter(([url]) => !visibleUrls.current.has(url))
      .slice(0, EVICTION_BATCH_SIZE)

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

  const loadTexture = useCallback(async (url: string, size: ImageSize) => {
    if (textureCache.current.has(url) || loadingSet.current.has(url)) {
      return
    }

    loadingSet.current.add(url)
    activeLoads.current[size]++

    try {
      // Get resized URL for loading
      const resizedUrl = getResizedUrl(url, size)
      const texture = await Assets.load<Texture>(resizedUrl)

      textureCache.current.set(url, {
        texture,
        lastUsed: Date.now(),
        size,
      })

      // Check if we need to evict
      evictIfNeeded()
    } catch (error) {
      // Silently fail - will show placeholder
      console.warn('Failed to load:', url)
    } finally {
      loadingSet.current.delete(url)
      activeLoads.current[size]--
    }
  }, [evictIfNeeded])

  const processQueue = useCallback(() => {
    frameCount.current++

    if (loadQueueMap.current.size === 0) return

    // Only process every 10 frames to reduce overhead
    if (frameCount.current % 10 !== 0) return

    // Separate queues by size
    const thumbQueue: Array<[string, number]> = []
    const mediumQueue: Array<[string, number]> = []

    for (const [url, entry] of loadQueueMap.current.entries()) {
      if (textureCache.current.has(url) || loadingSet.current.has(url)) {
        loadQueueMap.current.delete(url)
        continue
      }

      if (entry.size === 'thumb') {
        thumbQueue.push([url, entry.priority])
      } else {
        mediumQueue.push([url, entry.priority])
      }
    }

    // Sort by priority (lower = higher priority)
    thumbQueue.sort((a, b) => a[1] - b[1])
    mediumQueue.sort((a, b) => a[1] - b[1])

    // Process thumbnails (higher concurrency)
    let thumbProcessed = 0
    for (const [url] of thumbQueue) {
      if (activeLoads.current.thumb >= THUMB_CONCURRENT_LOADS || thumbProcessed >= 4) break
      loadQueueMap.current.delete(url)
      loadTexture(url, 'thumb')
      thumbProcessed++
    }

    // Process medium images (lower concurrency)
    let mediumProcessed = 0
    for (const [url] of mediumQueue) {
      if (activeLoads.current.medium >= MEDIUM_CONCURRENT_LOADS || mediumProcessed >= 2) break
      loadQueueMap.current.delete(url)
      loadTexture(url, 'medium')
      mediumProcessed++
    }
  }, [loadTexture])

  const requestLoad = useCallback((url: string, priority: number, size: ImageSize) => {
    // Already have it or loading it
    if (textureCache.current.has(url)) return
    if (loadingSet.current.has(url)) return

    const existing = loadQueueMap.current.get(url)
    if (existing !== undefined) {
      // Update priority if better (lower = higher priority)
      if (priority < existing.priority) {
        loadQueueMap.current.set(url, { priority, size })
      }
      return
    }

    loadQueueMap.current.set(url, { priority, size })
  }, [])

  // Mark a URL as currently visible (prevents eviction and disposal)
  const markVisible = useCallback((url: string) => {
    visibleUrls.current.add(url)

    // Cancel any pending disposal
    const timer = offscreenTimers.current.get(url)
    if (timer) {
      clearTimeout(timer)
      offscreenTimers.current.delete(url)
    }
  }, [])

  // Mark a URL as off-screen (schedules disposal)
  const markOffscreen = useCallback((url: string) => {
    visibleUrls.current.delete(url)

    // Don't schedule disposal if already scheduled or not in cache
    if (offscreenTimers.current.has(url)) return
    if (!textureCache.current.has(url)) return

    // Schedule disposal after delay
    const timer = setTimeout(() => {
      offscreenTimers.current.delete(url)

      // Double-check it's still off-screen
      if (visibleUrls.current.has(url)) return

      const entry = textureCache.current.get(url)
      if (entry) {
        entry.texture.destroy(true)
        textureCache.current.delete(url)
      }
    }, OFFSCREEN_DISPOSE_DELAY)

    offscreenTimers.current.set(url, timer)
  }, [])

  const clearQueue = useCallback(() => {
    loadQueueMap.current.clear()
  }, [])

  const hasPendingLoads = useCallback(() => {
    return loadQueueMap.current.size > 0 || activeLoads.current.thumb > 0 || activeLoads.current.medium > 0
  }, [])

  const getStats = useCallback(() => ({
    cached: textureCache.current.size,
    loading: activeLoads.current.thumb + activeLoads.current.medium,
    queued: loadQueueMap.current.size,
  }), [])

  return {
    getTexture,
    requestLoad,
    processQueue,
    getCategoryColor,
    clearQueue,
    hasPendingLoads,
    markVisible,
    markOffscreen,
    getStats,
  }
}
