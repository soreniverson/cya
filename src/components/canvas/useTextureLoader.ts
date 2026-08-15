'use client'

import { useRef, useCallback } from 'react'
import { Texture, Assets } from 'pixi.js'
import { MAX_CONCURRENT_LOADS, getCategoryColor } from './canvas-utils'

// Bound GPU memory. Only engages in a long session that has panned across a
// large part of the archive; a full viewport is at most ~500 textures.
const MAX_CACHED_TEXTURES = 900

// A texture is only a candidate once nothing has drawn it for this long.
// Deliberately wall-clock, not a frame or tick count: processQueue is driven by
// the render loop, by every load settling, and by a timer, so any counter it
// increments bears no relation to how long a texture has actually been idle.
const EVICT_GRACE_MS = 30_000
const EVICT_CHECK_INTERVAL_MS = 1_000

// A load may fail transiently (dropped connection, a blip at the origin).
// Retry with backoff before giving up on a URL for good.
const MAX_LOAD_ATTEMPTS = 3
const RETRY_BACKOFF_MS = 1_000

export interface TextureLoader {
  getTexture: (url: string) => Texture | null
  requestLoad: (url: string, priority: number) => void
  processQueue: () => void
  getCategoryColor: (category: string | null) => number
  clearQueue: () => void
  hasPendingLoads: () => boolean
  /** Called after each texture resolves, so the canvas can schedule a repaint. */
  setOnTextureLoaded: (cb: (() => void) | null) => void
  destroy: () => void
}

export function useTextureLoader(): TextureLoader {
  const textureCache = useRef<Map<string, Texture>>(new Map())
  const loadingSet = useRef<Set<string>>(new Set())
  // URLs that have failed MAX_LOAD_ATTEMPTS times. Without this a 404 satisfies
  // neither the cache nor the loading check, so it is re-queued every frame.
  const failedSet = useRef<Set<string>>(new Set())
  const attempts = useRef<Map<string, number>>(new Map())
  const retryAfter = useRef<Map<string, number>>(new Map())
  // Use Map for O(1) lookup instead of array.find() which is O(n)
  const loadQueueMap = useRef<Map<string, number>>(new Map()) // url -> priority
  const lastUsedAt = useRef<Map<string, number>>(new Map()) // url -> epoch ms
  const activeLoads = useRef<number>(0)
  const lastEvictCheck = useRef<number>(0)
  const onTextureLoaded = useRef<(() => void) | null>(null)
  const destroyed = useRef(false)
  // Set while a queue drain is already scheduled, so we schedule at most one.
  const pumpScheduled = useRef(false)
  // processQueue is defined below but referenced from loadTexture; a ref keeps
  // the two mutually recursive without a declaration-order problem.
  const processQueueRef = useRef<() => void>(() => {})

  const setOnTextureLoaded = useCallback((cb: (() => void) | null) => {
    onTextureLoaded.current = cb
  }, [])

  const getTexture = useCallback((url: string): Texture | null => {
    const texture = textureCache.current.get(url)
    if (!texture) return null
    // Touch on every read. Anything currently drawn is touched each frame, so
    // an on-screen texture can never age into the eviction window.
    lastUsedAt.current.set(url, Date.now())
    return texture
  }, [])

  /** True when the URL is unavailable right now: cached, in flight, or cooling off. */
  const isUnavailable = useCallback((url: string): boolean => {
    if (textureCache.current.has(url)) return true
    if (loadingSet.current.has(url)) return true
    if (failedSet.current.has(url)) return true
    const until = retryAfter.current.get(url)
    return until !== undefined && Date.now() < until
  }, [])

  const loadTexture = useCallback(async (url: string) => {
    if (isUnavailable(url)) return

    loadingSet.current.add(url)
    activeLoads.current++

    try {
      const texture = await Assets.load<Texture>(url)
      if (destroyed.current) return
      textureCache.current.set(url, texture)
      lastUsedAt.current.set(url, Date.now())
      attempts.current.delete(url)
      retryAfter.current.delete(url)
    } catch {
      const n = (attempts.current.get(url) ?? 0) + 1
      attempts.current.set(url, n)
      if (n >= MAX_LOAD_ATTEMPTS) {
        // Genuinely broken. Stop asking; the placeholder stands in.
        failedSet.current.add(url)
      } else {
        // Probably transient. Back off, then let it be requeued.
        retryAfter.current.set(url, Date.now() + RETRY_BACKOFF_MS * n)
      }
    } finally {
      loadingSet.current.delete(url)
      activeLoads.current--
      if (!destroyed.current) {
        // Refill the pipeline immediately rather than waiting for the next
        // animation frame. This is what keeps loading alive in a background
        // tab, where requestAnimationFrame is halted entirely.
        processQueueRef.current()
        onTextureLoaded.current?.()
      }
    }
  }, [isUnavailable])

  /** Release textures nothing has drawn for a while. */
  const evictIfNeeded = useCallback(() => {
    const cache = textureCache.current
    if (cache.size <= MAX_CACHED_TEXTURES) return

    const cutoff = Date.now() - EVICT_GRACE_MS
    const candidates: Array<[string, number]> = []
    for (const url of cache.keys()) {
      const used = lastUsedAt.current.get(url) ?? 0
      if (used < cutoff) candidates.push([url, used])
    }

    candidates.sort((a, b) => a[1] - b[1]) // least recently used first

    let toEvict = cache.size - MAX_CACHED_TEXTURES
    for (const [url] of candidates) {
      if (toEvict <= 0) break
      cache.delete(url)
      lastUsedAt.current.delete(url)
      // Hand the whole job to Pixi. Destroying the texture ourselves *and*
      // unloading raced: Assets could still serve the destroyed instance to a
      // later load of the same URL, which draws as a blank tile instead of
      // refetching. Assets.unload disposes it and clears its own cache together.
      Assets.unload(url).catch(() => {})
      toEvict--
    }
  }, [])

  const processQueue = useCallback(() => {
    const now = Date.now()
    if (now - lastEvictCheck.current > EVICT_CHECK_INTERVAL_MS) {
      lastEvictCheck.current = now
      evictIfNeeded()
    }

    const free = MAX_CONCURRENT_LOADS - activeLoads.current
    if (loadQueueMap.current.size === 0 || free <= 0) return

    // Nearest-to-centre first. Sorting the queue is only worth it when there is
    // actually a slot to fill, which the guard above already established.
    const toProcess = Array.from(loadQueueMap.current.entries())
    toProcess.sort((a, b) => a[1] - b[1]) // Sort by priority

    let started = 0
    for (const [url] of toProcess) {
      if (started >= free) break

      if (isUnavailable(url)) {
        // Leave cooling-off URLs queued so they get another go once the backoff
        // expires; drop the ones that are cached, loading, or permanently dead.
        if (!retryAfter.current.has(url) || failedSet.current.has(url)) {
          loadQueueMap.current.delete(url)
        }
        continue
      }

      loadQueueMap.current.delete(url)
      loadTexture(url)
      started++
    }
  }, [loadTexture, evictIfNeeded, isUnavailable])

  processQueueRef.current = processQueue

  /**
   * Drain the queue on a timer as well as from the render loop.
   *
   * The render loop is not a reliable driver: browsers halt
   * requestAnimationFrame in background tabs, so a canvas opened in a
   * background tab used to fetch nothing at all until it was focused.
   */
  const schedulePump = useCallback(() => {
    if (pumpScheduled.current || destroyed.current) return
    pumpScheduled.current = true
    setTimeout(() => {
      pumpScheduled.current = false
      if (destroyed.current) return
      processQueueRef.current()
      if (loadQueueMap.current.size > 0) schedulePump()
    }, RETRY_BACKOFF_MS / 4)
  }, [])

  const requestLoad = useCallback((url: string, priority: number) => {
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
    schedulePump()
  }, [schedulePump])

  const clearQueue = useCallback(() => {
    loadQueueMap.current.clear()
  }, [])

  const hasPendingLoads = useCallback(() => {
    return loadQueueMap.current.size > 0 || activeLoads.current > 0
  }, [])

  // Release every texture on unmount so a client-side navigation away from the
  // canvas doesn't strand the whole archive in GPU memory.
  const destroy = useCallback(() => {
    destroyed.current = true
    onTextureLoaded.current = null
    for (const url of textureCache.current.keys()) {
      Assets.unload(url).catch(() => {})
    }
    textureCache.current.clear()
    lastUsedAt.current.clear()
    loadQueueMap.current.clear()
    failedSet.current.clear()
    attempts.current.clear()
    retryAfter.current.clear()
    loadingSet.current.clear()
  }, [])

  return {
    getTexture,
    requestLoad,
    processQueue,
    getCategoryColor,
    clearQueue,
    hasPendingLoads,
    setOnTextureLoaded,
    destroy,
  }
}
