'use client'

import { useRef, useCallback } from 'react'
import { Container, Sprite, Texture, Graphics, Application } from 'pixi.js'
import type { TextureLoader } from './useTextureLoader'
import type { Concept } from '@/lib/types'
import {
  type VisibleCard,
  type Viewport,
  type GridConfig,
  getCardKey,
  getThumbUrl,
  getMidUrl,
  getCardWorldPosition,
  CARD_SIZE,
  CELL_SIZE,
  LOD,
  MIN_ZOOM,
  MAX_ZOOM,
} from './canvas-utils'

interface PooledCard {
  key: string
  container: Container
  imageSprite: Sprite | null
  mask: Graphics | null              // Rounded corner mask
  conceptIndex: number
  // Two-tier image tracking: thumb first, then mid when zoomed in
  currentTextureUrl: string | null  // Currently displayed texture
  hasThumb: boolean                  // Has thumb loaded
  hasMid: boolean                    // Has mid-res loaded (never downgrade from this)
  // Animation state
  currentX: number
  currentY: number
  targetX: number
  targetY: number
  currentAlpha: number
  targetAlpha: number
  currentScale: number
  targetScale: number
  // Image fade-in state
  imageAlpha: number
  // Mask state
  lastMaskRadius: number
}

// Animation config
const LERP_SPEED = 0.12 // How fast cards animate (0-1, higher = faster)
const CLUSTER_CARD_SCALE = 1.0 // Scale of cards in cluster
const MAX_BORDER_RADIUS = 2 // Max border radius when fully zoomed in

// Calculate border radius based on zoom (0 at min zoom, MAX_BORDER_RADIUS at max zoom)
function getBorderRadius(zoom: number): number {
  const t = (zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)
  return Math.max(0, Math.min(MAX_BORDER_RADIUS, t * MAX_BORDER_RADIUS))
}

export interface SpritePool {
  init: (app: Application) => void
  update: (
    visibleCards: VisibleCard[],
    viewport: Viewport,
    textureLoader: TextureLoader,
    filteredIndices: Set<number>,
    hoveredIndex: number | null,
    concepts: Concept[],
    isClusterMode: boolean,
    gridConfig: GridConfig
  ) => boolean // Returns true if still animating
  getContainer: () => Container
  cleanup: () => void
}

function lerp(current: number, target: number, speed: number): number {
  const diff = target - current
  if (Math.abs(diff) < 0.5) return target // Snap when close
  return current + diff * speed
}

// Cache signature for cluster layout invalidation
function getFilterSignature(indices: Set<number>): string {
  if (indices.size === 0) return ''
  if (indices.size > 200) return `size:${indices.size}` // For large sets, just use size
  // For smaller sets, use actual content
  const arr = Array.from(indices)
  arr.sort((a, b) => a - b)
  return arr.join(',')
}

export function useSpritePool(): SpritePool {
  const appRef = useRef<Application | null>(null)
  const containerRef = useRef<Container | null>(null)
  const activeCardsRef = useRef<Map<string, PooledCard>>(new Map())
  const recyclePoolRef = useRef<PooledCard[]>([])
  const clusterLayoutRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const lastClusterModeRef = useRef<boolean>(false)
  const lastFilterSignatureRef = useRef<string>('')
  const lastClusterCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const getContainer = useCallback((): Container => {
    if (!containerRef.current) {
      containerRef.current = new Container()
    }
    return containerRef.current
  }, [])

  const init = useCallback((app: Application) => {
    appRef.current = app
  }, [])

  const acquireCard = useCallback((key: string, index: number, x: number, y: number): PooledCard => {
    let card = recyclePoolRef.current.pop()

    if (card) {
      card.key = key
      card.conceptIndex = index
      card.container.visible = true
      card.container.alpha = 1
      card.container.scale.set(1)
      card.currentX = x
      card.currentY = y
      card.targetX = x
      card.targetY = y
      card.currentAlpha = 1
      card.targetAlpha = 1
      card.currentScale = 1
      card.targetScale = 1
      card.imageAlpha = 0
      card.currentTextureUrl = null
      card.hasThumb = false
      card.hasMid = false
      card.lastMaskRadius = -1
    } else {
      const container = new Container()

      card = {
        key,
        container,
        imageSprite: null,
        mask: null,
        conceptIndex: index,
        currentTextureUrl: null,
        hasThumb: false,
        hasMid: false,
        currentX: x,
        currentY: y,
        targetX: x,
        targetY: y,
        currentAlpha: 1,
        targetAlpha: 1,
        currentScale: 1,
        targetScale: 1,
        imageAlpha: 0,
        lastMaskRadius: -1,
      }

      getContainer().addChild(container)
    }

    activeCardsRef.current.set(key, card)
    return card
  }, [getContainer])

  const releaseCard = useCallback((key: string) => {
    const card = activeCardsRef.current.get(key)
    if (!card) return

    activeCardsRef.current.delete(key)
    card.container.visible = false

    if (card.imageSprite) {
      card.imageSprite.texture = Texture.EMPTY
      card.imageSprite.visible = false
      card.imageSprite.mask = null
    }
    card.currentTextureUrl = null
    card.hasThumb = false
    card.hasMid = false
    card.lastMaskRadius = -1

    recyclePoolRef.current.push(card)
  }, [])

  // Calculate cluster layout centered on viewport
  const calculateClusterLayout = useCallback((
    filteredIndices: Set<number>,
    viewport: Viewport,
    totalConcepts: number
  ) => {
    const layout = new Map<number, { x: number; y: number }>()
    const indices = Array.from(filteredIndices).sort((a, b) => a - b)
    const count = indices.length

    if (count === 0) return layout

    // Calculate grid dimensions for cluster
    const cols = Math.ceil(Math.sqrt(count * 1.5)) // Slightly wider than tall
    const rows = Math.ceil(count / cols)

    // Center of viewport in world coordinates
    const centerX = viewport.pan.x
    const centerY = viewport.pan.y

    // Calculate cluster dimensions
    const clusterWidth = cols * CELL_SIZE
    const clusterHeight = rows * CELL_SIZE

    // Top-left of cluster
    const startX = centerX - clusterWidth / 2
    const startY = centerY - clusterHeight / 2

    // Assign positions
    indices.forEach((conceptIndex, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      layout.set(conceptIndex, {
        x: startX + col * CELL_SIZE + CELL_SIZE / 2 - CARD_SIZE / 2,
        y: startY + row * CELL_SIZE + CELL_SIZE / 2 - CARD_SIZE / 2,
      })
    })

    return layout
  }, [])

  const update = useCallback((
    visibleCards: VisibleCard[],
    viewport: Viewport,
    textureLoader: TextureLoader,
    filteredIndices: Set<number>,
    hoveredIndex: number | null,
    concepts: Concept[],
    isClusterMode: boolean,
    gridConfig: GridConfig
  ): boolean => {
    const container = getContainer()
    let isAnimating = false
    const totalConcepts = concepts.length

    // Update container transform
    container.scale.set(viewport.zoom)
    container.x = viewport.width / 2 - viewport.pan.x * viewport.zoom
    container.y = viewport.height / 2 - viewport.pan.y * viewport.zoom

    const isFiltering = filteredIndices.size < totalConcepts

    // Only recalculate cluster layout when needed (signature changed or mode changed)
    const currentSignature = isClusterMode ? getFilterSignature(filteredIndices) : ''
    const centerMoved = isClusterMode && (
      Math.abs(viewport.pan.x - lastClusterCenterRef.current.x) > 100 ||
      Math.abs(viewport.pan.y - lastClusterCenterRef.current.y) > 100
    )

    if (isClusterMode) {
      if (currentSignature !== lastFilterSignatureRef.current || !lastClusterModeRef.current || centerMoved) {
        clusterLayoutRef.current = calculateClusterLayout(filteredIndices, viewport, totalConcepts)
        lastFilterSignatureRef.current = currentSignature
        lastClusterCenterRef.current = { x: viewport.pan.x, y: viewport.pan.y }
      }
    } else if (!isClusterMode && lastClusterModeRef.current) {
      clusterLayoutRef.current.clear()
      lastFilterSignatureRef.current = ''
    }
    lastClusterModeRef.current = isClusterMode

    const neededKeys = new Set<string>()

    // Build a Set of visible concept indices for O(1) lookup (FIX: was O(n²))
    const visibleConceptIndices = new Set<number>()
    for (const vc of visibleCards) {
      visibleConceptIndices.add(vc.index % totalConcepts)
    }

    // In cluster mode, we need to show filtered cards that aren't currently visible
    // But limit to avoid performance issues (max 150 cards in cluster)
    const cardsToRender = new Map<string, VisibleCard>()

    // First add all visible cards from the grid
    for (const vc of visibleCards) {
      const key = getCardKey(vc.index, vc.tileX, vc.tileY)
      cardsToRender.set(key, vc)
    }

    // In cluster mode, add synthetic cards for filtered indices not visible
    if (isClusterMode) {
      let addedCount = 0
      const maxClusterCards = 150 // Cap to prevent performance issues

      for (const conceptIndex of filteredIndices) {
        if (addedCount >= maxClusterCards) break

        // O(1) lookup instead of O(n) loop
        if (!visibleConceptIndices.has(conceptIndex)) {
          const clusterPos = clusterLayoutRef.current.get(conceptIndex)
          if (clusterPos) {
            const gridPos = getCardWorldPosition(conceptIndex, gridConfig)
            const key = `cluster-${conceptIndex}`
            cardsToRender.set(key, {
              concept: concepts[conceptIndex],
              index: conceptIndex,
              worldX: gridPos.x,
              worldY: gridPos.y,
              tileX: 0,
              tileY: 0,
              screenX: 0,
              screenY: 0,
              screenSize: 0,
              distanceFromCenter: 0,
            })
            addedCount++
          }
        }
      }
    }

    for (const [cardKey, visibleCard] of cardsToRender) {
      const { index, worldX, worldY, tileX, tileY, distanceFromCenter } = visibleCard
      const key = cardKey.startsWith('cluster-') ? cardKey : getCardKey(index, tileX, tileY)
      neededKeys.add(key)

      const conceptIndex = index % totalConcepts
      const concept = visibleCard.concept || concepts[conceptIndex]
      const isMatching = filteredIndices.has(conceptIndex)

      // Determine target position and alpha
      let targetX = worldX
      let targetY = worldY
      let targetAlpha = 1
      let targetScale = 1

      if (isClusterMode) {
        if (isMatching) {
          // Move to cluster position
          const clusterPos = clusterLayoutRef.current.get(conceptIndex)
          if (clusterPos) {
            targetX = clusterPos.x
            targetY = clusterPos.y
          }
          targetAlpha = 1
          targetScale = CLUSTER_CARD_SCALE
        } else {
          // Fade out and scale down
          targetAlpha = 0
          targetScale = 0.8
        }
      } else if (isFiltering && !isMatching) {
        // Regular filtering (not cluster mode) - hide non-matching cards
        targetAlpha = 0
        targetScale = 0.9
      }

      // Get or create card
      let card = activeCardsRef.current.get(key)
      if (!card) {
        card = acquireCard(key, index, worldX, worldY)
        // If entering cluster mode, start from grid position
        if (isClusterMode && isMatching) {
          card.currentX = worldX
          card.currentY = worldY
        }
      }

      // Set targets
      card.targetX = targetX
      card.targetY = targetY
      card.targetAlpha = targetAlpha
      card.targetScale = targetScale

      // Animate current values toward targets
      card.currentX = lerp(card.currentX, card.targetX, LERP_SPEED)
      card.currentY = lerp(card.currentY, card.targetY, LERP_SPEED)
      card.currentAlpha = lerp(card.currentAlpha, card.targetAlpha, LERP_SPEED)
      card.currentScale = lerp(card.currentScale, card.targetScale, LERP_SPEED)

      // Check if still animating
      if (
        Math.abs(card.currentX - card.targetX) > 0.5 ||
        Math.abs(card.currentY - card.targetY) > 0.5 ||
        Math.abs(card.currentAlpha - card.targetAlpha) > 0.01 ||
        Math.abs(card.currentScale - card.targetScale) > 0.01
      ) {
        isAnimating = true
      }

      // Apply to container
      card.container.x = card.currentX
      card.container.y = card.currentY
      card.container.alpha = card.currentAlpha
      card.container.scale.set(card.currentScale)

      // Handle image sprite with two-tier loading
      // Rule: Always load thumb first, then mid when zoomed in. Never downgrade.
      const shouldShowImage = card.currentAlpha > 0.1 && concept
      if (shouldShowImage) {
        const thumbUrl = getThumbUrl(concept)
        const midUrl = getMidUrl(concept)
        const wantMid = viewport.zoom >= LOD.LOAD_MID_RES

        // Check what textures we have available
        const thumbTexture = textureLoader.getTexture(thumbUrl)
        const midTexture = wantMid ? textureLoader.getTexture(midUrl) : null

        // Determine which texture to display (never downgrade from mid)
        let textureToUse: Texture | null = null
        let urlToUse: string | null = null

        if (card.hasMid && midTexture) {
          // Already showing mid, keep it
          textureToUse = midTexture
          urlToUse = midUrl
        } else if (midTexture) {
          // Mid just loaded, upgrade to it
          textureToUse = midTexture
          urlToUse = midUrl
          card.hasMid = true
        } else if (thumbTexture) {
          // Use thumb (either as fallback or primary)
          textureToUse = thumbTexture
          urlToUse = thumbUrl
          card.hasThumb = true
        }

        if (textureToUse && urlToUse) {
          if (!card.imageSprite) {
            card.imageSprite = new Sprite()
            card.container.addChild(card.imageSprite)
          }

          const isNewTexture = card.currentTextureUrl !== urlToUse
          if (isNewTexture) {
            card.imageSprite.texture = textureToUse

            // Cover fit
            const imgAspect = textureToUse.width / textureToUse.height
            if (imgAspect > 1) {
              card.imageSprite.height = CARD_SIZE
              card.imageSprite.width = CARD_SIZE * imgAspect
              card.imageSprite.x = -(card.imageSprite.width - CARD_SIZE) / 2
              card.imageSprite.y = 0
            } else {
              card.imageSprite.width = CARD_SIZE
              card.imageSprite.height = CARD_SIZE / imgAspect
              card.imageSprite.x = 0
              card.imageSprite.y = -(card.imageSprite.height - CARD_SIZE) / 2
            }

            card.currentTextureUrl = urlToUse
            // Only reset fade if this is the first image (not an upgrade)
            if (!card.hasThumb || urlToUse === thumbUrl) {
              card.imageAlpha = 0
            }
          }

          // Animate image fade-in
          card.imageAlpha = lerp(card.imageAlpha, 1, LERP_SPEED * 1.5)
          card.imageSprite.alpha = card.imageAlpha
          card.imageSprite.visible = true

          // Update rounded corner mask based on zoom
          const borderRadius = getBorderRadius(viewport.zoom)
          if (borderRadius > 0.1) {
            // Only create/update mask if radius is noticeable
            if (!card.mask) {
              card.mask = new Graphics()
              card.mask.renderable = false // Don't render mask itself, only use as mask
              card.container.addChild(card.mask)
            }
            // Only redraw if radius changed significantly
            if (Math.abs(borderRadius - card.lastMaskRadius) > 0.1) {
              card.mask.clear()
              card.mask.roundRect(0, 0, CARD_SIZE, CARD_SIZE, borderRadius)
              card.mask.fill({ color: 0xffffff })
              card.lastMaskRadius = borderRadius
            }
            card.imageSprite.mask = card.mask
          } else {
            // No border radius needed
            if (card.imageSprite.mask) {
              card.imageSprite.mask = null
            }
          }

          // Check if image is still animating
          if (card.imageAlpha < 0.99) {
            isAnimating = true
          }
        } else {
          if (card.imageSprite) {
            card.imageSprite.visible = false
            card.imageSprite.mask = null
          }
        }

        // Request loads for images we don't have yet
        // Load thumb and mid in parallel when zoomed in (same priority)
        if (!thumbTexture) {
          textureLoader.requestLoad(thumbUrl, distanceFromCenter)
        }
        // Request mid-res when zoomed in (same priority - load in parallel)
        if (wantMid && !midTexture && thumbUrl !== midUrl) {
          textureLoader.requestLoad(midUrl, distanceFromCenter)
        }
      } else {
        if (card.imageSprite) {
          card.imageSprite.visible = false
        }
      }
    }

    // Release cards no longer needed
    for (const [key, card] of activeCardsRef.current) {
      if (!neededKeys.has(key)) {
        // If card is fading out, keep it until fully transparent
        if (card.currentAlpha > 0.01) {
          card.targetAlpha = 0
          card.targetScale = 0.8
          card.currentAlpha = lerp(card.currentAlpha, 0, LERP_SPEED)
          card.currentScale = lerp(card.currentScale, 0.8, LERP_SPEED)
          card.container.alpha = card.currentAlpha
          card.container.scale.set(card.currentScale)
          isAnimating = true
        } else {
          releaseCard(key)
        }
      }
    }

    // Process texture queue
    textureLoader.processQueue()

    return isAnimating
  }, [getContainer, acquireCard, releaseCard, calculateClusterLayout])

  const cleanup = useCallback(() => {
    for (const [key] of activeCardsRef.current) {
      releaseCard(key)
    }

    for (const card of recyclePoolRef.current) {
      card.container.destroy({ children: true })
    }
    recyclePoolRef.current = []

    if (containerRef.current) {
      containerRef.current.destroy({ children: true })
      containerRef.current = null
    }

    appRef.current = null
    clusterLayoutRef.current.clear()
    lastFilterSignatureRef.current = ''
    lastClusterCenterRef.current = { x: 0, y: 0 }
  }, [releaseCard])

  return {
    init,
    update,
    getContainer,
    cleanup,
  }
}
