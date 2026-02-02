'use client'

import { useRef, useCallback } from 'react'

const MAX_CONCURRENT_LOADS = 6

export interface ImageLoader {
  getImage: (url: string) => HTMLImageElement | null
  loadImage: (url: string, priority: number) => void
  isLoading: (url: string) => boolean
}

interface LoadRequest {
  url: string
  priority: number
}

export function useImageLoader(): ImageLoader {
  const cacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const loadingRef = useRef<Set<string>>(new Set())
  const queueRef = useRef<LoadRequest[]>([])
  const activeLoadsRef = useRef<number>(0)

  const processQueue = useCallback(() => {
    if (activeLoadsRef.current >= MAX_CONCURRENT_LOADS) return
    if (queueRef.current.length === 0) return

    // Sort by priority (lower = higher priority)
    queueRef.current.sort((a, b) => a.priority - b.priority)

    while (
      activeLoadsRef.current < MAX_CONCURRENT_LOADS &&
      queueRef.current.length > 0
    ) {
      const request = queueRef.current.shift()
      if (!request) break

      // Skip if already loaded or currently loading
      if (cacheRef.current.has(request.url) || loadingRef.current.has(request.url)) {
        continue
      }

      loadingRef.current.add(request.url)
      activeLoadsRef.current++

      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = () => {
        cacheRef.current.set(request.url, img)
        loadingRef.current.delete(request.url)
        activeLoadsRef.current--
        processQueue()
      }

      img.onerror = () => {
        loadingRef.current.delete(request.url)
        activeLoadsRef.current--
        processQueue()
      }

      img.src = request.url
    }
  }, [])

  const getImage = useCallback((url: string): HTMLImageElement | null => {
    return cacheRef.current.get(url) ?? null
  }, [])

  const loadImage = useCallback(
    (url: string, priority: number) => {
      // Already loaded
      if (cacheRef.current.has(url)) return

      // Already in queue, update priority
      const existingIndex = queueRef.current.findIndex((r) => r.url === url)
      if (existingIndex !== -1) {
        queueRef.current[existingIndex].priority = Math.min(
          queueRef.current[existingIndex].priority,
          priority
        )
        return
      }

      // Already loading
      if (loadingRef.current.has(url)) return

      // Add to queue
      queueRef.current.push({ url, priority })
      processQueue()
    },
    [processQueue]
  )

  const isLoading = useCallback((url: string): boolean => {
    return loadingRef.current.has(url)
  }, [])

  return {
    getImage,
    loadImage,
    isLoading,
  }
}
