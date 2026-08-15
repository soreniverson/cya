'use client'

import { useRef, useCallback } from 'react'
import { Texture, ImageSource } from 'pixi.js'
import { getCategoryColor, type GridConfig, type Viewport } from './canvas-utils'
import {
  buildPrefetchPlan,
  depthFromConnection,
  tierOfPriority,
  TIER,
  type Motion,
  type PrefetchDepth,
  type Tier,
} from './prefetch'
import type { CanvasConcept } from '@/lib/types'

/**
 * GPU budget for decoded textures, in bytes.
 *
 * Measured rather than guessed: a thumbnail is 150x150 RGBA = 88 KB, and the
 * archive holds 964 of them, so every thumbnail at once is ~85 MB. Mid-res is
 * 800x800 = 2.5 MB each but only a few dozen are ever on screen. navigator
 * .deviceMemory lets small devices opt down instead of being handed a desktop
 * budget.
 */
function textureBudgetBytes(): number {
  const gb =
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === 'number'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory!
      : 8
  if (gb <= 2) return 96 * 1024 * 1024
  if (gb <= 4) return 160 * 1024 * 1024
  return 320 * 1024 * 1024
}

// Concurrency adapts at runtime between these bounds; see adaptConcurrency.
// The ceiling is where measurement stopped paying: benchmarked against the
// production origin, throughput was 20 img/s at 6, 65 at 20, 67 at 24 and 75 at
// 32, but run-to-run spread roughly tripled past 24. 32 is the last point the
// data supports; beyond it the extra parallelism buys noise and leans harder on
// the origin for nothing.
const MIN_CONCURRENCY = 8
const MAX_CONCURRENCY = 32
const START_CONCURRENCY = 24

const MAX_LOAD_ATTEMPTS = 3
const RETRY_BACKOFF_MS = 1_000

/** A texture untouched for this long may be evicted once over budget. */
const EVICT_GRACE_MS = 20_000

interface CacheEntry {
  texture: Texture
  bytes: number
  lastUsedAt: number
}

interface InFlight {
  controller: AbortController
  /** Set once bytes have arrived; after this, cancelling wastes the download. */
  responseReceived: boolean
  priority: number
  startedAt: number
}

interface Timings {
  request: number[]
  decode: number[]
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))])
}

export interface CoverageSnapshot {
  visibleCards: number
  visibleReady: number
}

export interface TextureLoader {
  getTexture: (url: string) => Texture | null
  /** Feed the loader the camera state. This is what drives all fetching. */
  setViewport: (
    vp: Viewport,
    motion: Motion,
    cfg: GridConfig,
    concepts: CanvasConcept[]
  ) => void
  /** Immediate, highest-priority request for something on screen right now. */
  requestLoad: (url: string, distanceFromCentre: number) => void
  processQueue: () => void
  getCategoryColor: (category: string | null) => number
  clearQueue: () => void
  hasPendingLoads: () => boolean
  setOnTextureLoaded: (cb: (() => void) | null) => void
  reportCoverage: (snapshot: CoverageSnapshot) => void
  destroy: () => void
}

export function useTextureLoader(): TextureLoader {
  const cache = useRef<Map<string, CacheEntry>>(new Map())
  const cacheBytes = useRef(0)
  const budget = useRef<number>(0)
  if (budget.current === 0 && typeof window !== 'undefined') budget.current = textureBudgetBytes()

  const queue = useRef<Map<string, number>>(new Map()) // url -> priority
  const inFlight = useRef<Map<string, InFlight>>(new Map())
  const failed = useRef<Set<string>>(new Set())
  const attempts = useRef<Map<string, number>>(new Map())
  const retryAfter = useRef<Map<string, number>>(new Map())

  const depth = useRef<PrefetchDepth | null>(null)
  const concurrency = useRef(START_CONCURRENCY)
  const recentLatency = useRef<number[]>([])
  const prevWindowP50 = useRef(0)
  const timings = useRef<Timings>({ request: [], decode: [] })

  const onLoaded = useRef<(() => void) | null>(null)
  const destroyed = useRef(false)
  const pumpScheduled = useRef(false)
  const drainRef = useRef<() => void>(() => {})

  // Coverage accounting, for __cyaPerf and the benchmarks.
  const lastViewportChange = useRef(0)
  const firstFrameCoverage = useRef<number | null>(null)
  const timeTo98 = useRef<number | null>(null)
  const timeTo100 = useRef<number | null>(null)
  const coverage = useRef<CoverageSnapshot>({ visibleCards: 0, visibleReady: 0 })
  const lastPlanCount = useRef(0)
  const predictedReady = useRef(0)

  const setOnTextureLoaded = useCallback((cb: (() => void) | null) => {
    onLoaded.current = cb
  }, [])

  const getTexture = useCallback((url: string): Texture | null => {
    const hit = cache.current.get(url)
    if (!hit) return null
    hit.lastUsedAt = Date.now()
    return hit.texture
  }, [])

  const isUnavailable = useCallback((url: string): boolean => {
    if (cache.current.has(url)) return true
    if (inFlight.current.has(url)) return true
    if (failed.current.has(url)) return true
    const until = retryAfter.current.get(url)
    return until !== undefined && Date.now() < until
  }, [])

  /**
   * Evict least-recently-used textures until under budget. Anything drawn this
   * frame was just touched by getTexture, so it can never be a candidate.
   */
  const evict = useCallback(() => {
    if (cacheBytes.current <= budget.current) return
    const cutoff = Date.now() - EVICT_GRACE_MS
    const candidates: Array<[string, number]> = []
    for (const [url, e] of cache.current) {
      if (e.lastUsedAt < cutoff) candidates.push([url, e.lastUsedAt])
    }
    candidates.sort((a, b) => a[1] - b[1])
    for (const [url] of candidates) {
      if (cacheBytes.current <= budget.current * 0.9) break
      const e = cache.current.get(url)
      if (!e) continue
      cache.current.delete(url)
      cacheBytes.current -= e.bytes
      e.texture.destroy(true)
    }
  }, [])

  /**
   * Adapt concurrency from a congestion signal: is latency getting worse than
   * it was one window ago?
   *
   * Deliberately not measured against an all-time best. Cache hits return in
   * ~1 ms while cold requests take ~230 ms, so a best-latency baseline makes
   * every genuine request look like catastrophic congestion and pins
   * concurrency to the floor - which is exactly what it did on first run.
   */
  const adaptConcurrency = useCallback((latencyMs: number) => {
    const w = recentLatency.current
    w.push(latencyMs)
    if (w.length < 20) return

    const p50 = percentile(w, 0.5)
    w.length = 0

    const prev = prevWindowP50.current
    prevWindowP50.current = p50
    if (prev <= 0) return

    const trend = p50 / prev
    if (trend > 1.6) {
      // Latency climbing: we are queueing somewhere. Back off.
      concurrency.current = Math.max(MIN_CONCURRENCY, Math.floor(concurrency.current * 0.75))
    } else if (trend < 1.2 && queue.current.size > concurrency.current) {
      // Holding steady with work outstanding: there is headroom.
      concurrency.current = Math.min(MAX_CONCURRENCY, Math.ceil(concurrency.current * 1.25))
    }
  }, [])

  const noteCoverage = useCallback(() => {
    const { visibleCards, visibleReady } = coverage.current
    if (visibleCards === 0) return
    const pct = (visibleReady / visibleCards) * 100
    const since = Date.now() - lastViewportChange.current
    if (firstFrameCoverage.current === null) firstFrameCoverage.current = pct
    if (timeTo98.current === null && pct >= 98) timeTo98.current = since
    if (timeTo100.current === null && pct >= 100) timeTo100.current = since
  }, [])

  const reportCoverage = useCallback(
    (snapshot: CoverageSnapshot) => {
      coverage.current = snapshot
      noteCoverage()
    },
    [noteCoverage]
  )

  /**
   * Fetch + decode ourselves rather than going through Assets.load. That buys
   * three things the old path could not offer: per-stage timings, real
   * cancellation, and a texture we own outright so eviction cannot race Pixi's
   * global asset cache.
   */
  const load = useCallback(
    async (url: string, priority: number) => {
      if (isUnavailable(url)) return

      const controller = new AbortController()
      const startedAt = performance.now()
      const record: InFlight = { controller, responseReceived: false, priority, startedAt }
      inFlight.current.set(url, record)

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          // Background tiers must not compete with what is on screen.
          priority: tierOfPriority(priority) >= TIER.OVERSCAN ? 'low' : 'high',
        } as RequestInit)
        record.responseReceived = true
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const requestMs = performance.now() - startedAt
        timings.current.request.push(requestMs)
        if (timings.current.request.length > 200) timings.current.request.shift()
        adaptConcurrency(requestMs)

        const decodeStart = performance.now()
        const bitmap = await createImageBitmap(blob)
        const decodeMs = performance.now() - decodeStart
        timings.current.decode.push(decodeMs)
        if (timings.current.decode.length > 200) timings.current.decode.shift()

        if (destroyed.current) {
          bitmap.close()
          return
        }

        const texture = new Texture({ source: new ImageSource({ resource: bitmap }) })
        const bytes = bitmap.width * bitmap.height * 4
        cache.current.set(url, { texture, bytes, lastUsedAt: Date.now() })
        cacheBytes.current += bytes
        attempts.current.delete(url)
        retryAfter.current.delete(url)
        if (cacheBytes.current > budget.current) evict()
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          // Cancelled on purpose; leave it eligible for a later request.
          return
        }
        const n = (attempts.current.get(url) ?? 0) + 1
        attempts.current.set(url, n)
        if (n >= MAX_LOAD_ATTEMPTS) failed.current.add(url)
        else retryAfter.current.set(url, Date.now() + RETRY_BACKOFF_MS * n)
      } finally {
        inFlight.current.delete(url)
        if (!destroyed.current) {
          drainRef.current()
          onLoaded.current?.()
        }
      }
    },
    [isUnavailable, adaptConcurrency, evict]
  )

  /** Start as much work as the current concurrency allows, highest tier first. */
  const drain = useCallback(() => {
    const free = concurrency.current - inFlight.current.size
    if (free <= 0 || queue.current.size === 0) return

    const entries = Array.from(queue.current.entries())
    entries.sort((a, b) => a[1] - b[1])

    let started = 0
    for (const [url, priority] of entries) {
      if (started >= free) break
      if (cache.current.has(url) || failed.current.has(url)) {
        queue.current.delete(url)
        continue
      }
      if (inFlight.current.has(url)) continue
      const until = retryAfter.current.get(url)
      if (until !== undefined && Date.now() < until) continue
      queue.current.delete(url)
      load(url, priority)
      started++
    }
  }, [load])

  drainRef.current = drain

  const schedulePump = useCallback(() => {
    if (pumpScheduled.current || destroyed.current) return
    pumpScheduled.current = true
    setTimeout(() => {
      pumpScheduled.current = false
      if (destroyed.current) return
      drainRef.current()
      if (queue.current.size > 0) schedulePump()
    }, 0)
  }, [])

  /**
   * The entry point. Rebuilds the plan, promotes anything newly important,
   * demotes stale preload work, and cancels in-flight requests that have become
   * irrelevant and have not yet received bytes.
   *
   * Deliberately not driven by requestAnimationFrame: the camera can change
   * from a pointer event or a resize, and background tabs must still prefetch.
   */
  const setViewport = useCallback(
    (vp: Viewport, motion: Motion, cfg: GridConfig, concepts: CanvasConcept[]) => {
      if (destroyed.current) return

      if (depth.current === null) depth.current = depthFromConnection()
      const plan = buildPrefetchPlan(vp, motion, cfg, concepts, depth.current)
      lastPlanCount.current = plan.length

      const next = new Map<string, number>()
      let ready = 0
      for (const entry of plan) {
        if (cache.current.has(entry.url)) {
          if (entry.tier <= TIER.PREDICTED) ready++
          continue
        }
        if (failed.current.has(entry.url)) continue
        const prev = next.get(entry.url)
        if (prev === undefined || entry.priority < prev) next.set(entry.url, entry.priority)
      }
      predictedReady.current = ready

      // Replace wholesale: stale entries from the previous viewport simply do
      // not appear, which is the demotion step. Anything still relevant carries
      // its new (possibly promoted) priority.
      queue.current = next

      // Cancel in-flight work that has fallen out of the plan entirely and has
      // not started receiving bytes. A request that is nearly complete is
      // cheaper to finish than to redo.
      for (const [url, rec] of inFlight.current) {
        if (rec.responseReceived) continue
        const stillWanted = next.get(url)
        if (stillWanted === undefined) {
          rec.controller.abort()
        } else {
          rec.priority = stillWanted
        }
      }

      schedulePump()
    },
    [schedulePump]
  )

  /** Called by the renderer for a card that is on screen and has no texture. */
  const requestLoad = useCallback(
    (url: string, distanceFromCentre: number) => {
      if (isUnavailable(url)) return
      const priority = TIER.VISIBLE * 1_000_000 + Math.round(distanceFromCentre / 1000)
      const existing = queue.current.get(url)
      if (existing === undefined || priority < existing) queue.current.set(url, priority)
      schedulePump()
    },
    [isUnavailable, schedulePump]
  )

  const processQueue = useCallback(() => {
    drainRef.current()
  }, [])

  const clearQueue = useCallback(() => {
    queue.current.clear()
  }, [])

  const hasPendingLoads = useCallback(() => {
    // Only work that can change what is on screen should hold the render loop
    // open; background prefetch must not pin requestAnimationFrame.
    for (const p of queue.current.values()) if (tierOfPriority(p) <= TIER.PREDICTED) return true
    for (const rec of inFlight.current.values()) if (tierOfPriority(rec.priority) <= TIER.PREDICTED) return true
    return false
  }, [])

  const destroy = useCallback(() => {
    destroyed.current = true
    onLoaded.current = null
    for (const rec of inFlight.current.values()) rec.controller.abort()
    inFlight.current.clear()
    for (const e of cache.current.values()) e.texture.destroy(true)
    cache.current.clear()
    cacheBytes.current = 0
    queue.current.clear()
    failed.current.clear()
    attempts.current.clear()
    retryAfter.current.clear()
  }, [])

  // Mark a viewport change so coverage timings restart. Called from setViewport
  // via the renderer, which knows when the camera actually moved.
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__cyaPerf = () => {
      const byPriority = { visible: 0, predicted: 0, overscan: 0, background: 0 }
      for (const p of queue.current.values()) {
        const t = tierOfPriority(p) as Tier
        if (t === TIER.VISIBLE) byPriority.visible++
        else if (t === TIER.PREDICTED) byPriority.predicted++
        else if (t === TIER.OVERSCAN) byPriority.overscan++
        else byPriority.background++
      }
      const { visibleCards, visibleReady } = coverage.current
      return {
        visibleCards,
        visibleReady,
        visibleMissing: visibleCards - visibleReady,
        visibleCoveragePct: visibleCards ? +((visibleReady / visibleCards) * 100).toFixed(1) : 100,
        predictedCards: lastPlanCount.current,
        predictedReady: predictedReady.current,
        queuedByPriority: byPriority,
        inFlight: inFlight.current.size,
        concurrency: concurrency.current,
        prefetchDepth: depth.current,
        cacheEntries: cache.current.size,
        cacheMemoryMB: +(cacheBytes.current / 1048576).toFixed(1),
        cacheBudgetMB: +(budget.current / 1048576).toFixed(0),
        requestLatencyP50: percentile(timings.current.request, 0.5),
        requestLatencyP95: percentile(timings.current.request, 0.95),
        decodeLatencyP50: percentile(timings.current.decode, 0.5),
        decodeLatencyP95: percentile(timings.current.decode, 0.95),
        lastViewportChangeMsAgo: lastViewportChange.current ? Date.now() - lastViewportChange.current : null,
        firstFrameCoverageAfterLastViewportChange:
          firstFrameCoverage.current === null ? null : +firstFrameCoverage.current.toFixed(1),
        timeTo98AfterLastViewportChange: timeTo98.current,
        timeTo100AfterLastViewportChange: timeTo100.current,
        permanentlyFailed: failed.current.size,
      }
    }
    ;(window as unknown as Record<string, unknown>).__cyaMarkViewportChange = () => {
      lastViewportChange.current = Date.now()
      firstFrameCoverage.current = null
      timeTo98.current = null
      timeTo100.current = null
    }
  }

  return {
    getTexture,
    setViewport,
    requestLoad,
    processQueue,
    getCategoryColor,
    clearQueue,
    hasPendingLoads,
    setOnTextureLoaded,
    reportCoverage,
    destroy,
  }
}
