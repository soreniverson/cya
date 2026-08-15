'use client'

import { useRef, useCallback } from 'react'
import { Texture, Assets } from 'pixi.js'
import { MAX_CONCURRENT_LOADS, getCategoryColor } from './canvas-utils'

// Bound GPU memory. Comfortably above VISIBLE_CARDS.MAX_ZOOMED_OUT (500) so
// nothing on screen is ever a candidate, but far below the ~1900 textures a
// long session on an infinite canvas would otherwise accumulate forever.
const MAX_CACHED_TEXTURES = 900
// A texture touched this recently may still be on screen - never evict it.
const EVICT_GRACE_FRAMES = 180

export interface TextureLoader {
  getTexture: (url: string) => Texture | null
  requestLoad: (url: string, priority: number) => void
  processQueue: () => void
  getCategoryColor: (category: string | null) => number
  clearQueue: () => void
  hasPendingLoads: () => boolean
  destroy: () => void
}

export function useTextureLoader(): TextureLoader {
  const textureCache = useRef<Map<string, Texture>>(new Map())
  const loadingSet = useRef<Set<string>>(new Set())
  // URLs that failed to load. Without this a 404 satisfies neither the cache
  // nor the loading check, so it gets re-queued on every single frame.
  const failedSet = useRef<Set<string>>(new Set())
  // Use Map for O(1) lookup instead of array.find() which is O(n)
  const loadQueueMap = useRef<Map<string, number>>(new Map()) // url -> priority
  const lastUsedFrame = useRef<Map<string, number>>(new Map())
  const activeLoads = useRef<number>(0)
  const frameCount = useRef<number>(0)

  const getTexture = useCallback((url: string): Texture | null => {
    const texture = textureCache.current.get(url)
    if (!texture) return null
    lastUsedFrame.current.set(url, frameCount.current)
    return texture
  }, [])

  const loadTexture = useCallback(async (url: string) => {
    if (
      textureCache.current.has(url) ||
      loadingSet.current.has(url) ||
      failedSet.current.has(url)
    ) {
      return
    }

    loadingSet.current.add(url)
    activeLoads.current++

    try {
      const texture = await Assets.load<Texture>(url)
      textureCache.current.set(url, texture)
      lastUsedFrame.current.set(url, frameCount.current)
    } catch {
      // Remember the failure so we stop asking. Shows the placeholder instead.
      failedSet.current.add(url)
    } finally {
      loadingSet.current.delete(url)
      activeLoads.current--
    }
  }, [])

  // Drop textures that have been off screen long enough to be safe to release.
  const evictIfNeeded = useCallback(() => {
    const cache = textureCache.current
    if (cache.size <= MAX_CACHED_TEXTURES) return

    const cutoff = frameCount.current - EVICT_GRACE_FRAMES
    const candidates: Array<[string, number]> = []
    for (const url of cache.keys()) {
      const used = lastUsedFrame.current.get(url) ?? 0
      if (used < cutoff) candidates.push([url, used])
    }

    candidates.sort((a, b) => a[1] - b[1]) // least recently used first

    let toEvict = cache.size - MAX_CACHED_TEXTURES
    for (const [url] of candidates) {
      if (toEvict <= 0) break
      const texture = cache.get(url)
      cache.delete(url)
      lastUsedFrame.current.delete(url)
      texture?.destroy(true)
      Assets.unload(url).catch(() => {})
      toEvict--
    }
  }, [])

  const processQueue = useCallback(() => {
    frameCount.current++

    // Cheap no-op until the cache is actually over budget.
    if (frameCount.current % 60 === 0) evictIfNeeded()

    if (loadQueueMap.current.size === 0) return

    // Convert to array and sort only when we need to process
    // Only sort every 10 frames to reduce overhead
    let toProcess: Array<[string, number]> | null = null
    if (frameCount.current % 10 === 0 || activeLoads.current < MAX_CONCURRENT_LOADS) {
      toProcess = Array.from(loadQueueMap.current.entries())
      toProcess.sort((a, b) => a[1] - b[1]) // Sort by priority
    }

    if (!toProcess) return

    // Process up to max concurrent loads
    let processed = 0
    for (const [url] of toProcess) {
      if (activeLoads.current >= MAX_CONCURRENT_LOADS || processed >= 6) break

      if (
        textureCache.current.has(url) ||
        loadingSet.current.has(url) ||
        failedSet.current.has(url)
      ) {
        loadQueueMap.current.delete(url)
        continue
      }

      loadQueueMap.current.delete(url)
      loadTexture(url)
      processed++
    }
  }, [loadTexture, evictIfNeeded])

  const requestLoad = useCallback((url: string, priority: number) => {
    // Already have it, loading it, or known to be broken
    if (textureCache.current.has(url)) return
    if (loadingSet.current.has(url)) return
    if (failedSet.current.has(url)) return

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

  // Release every texture on unmount so a client-side navigation away from the
  // canvas doesn't strand the whole archive in GPU memory.
  const destroy = useCallback(() => {
    for (const [url, texture] of textureCache.current) {
      texture.destroy(true)
      Assets.unload(url).catch(() => {})
    }
    textureCache.current.clear()
    lastUsedFrame.current.clear()
    loadQueueMap.current.clear()
    failedSet.current.clear()
    loadingSet.current.clear()
  }, [])

  return {
    getTexture,
    requestLoad,
    processQueue,
    getCategoryColor,
    clearQueue,
    hasPendingLoads,
    destroy,
  }
}
