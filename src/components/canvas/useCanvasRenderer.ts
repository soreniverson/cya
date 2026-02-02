'use client'

import { useCallback } from 'react'
import type { Concept } from '@/lib/types'
import type { CanvasState } from './useCanvasState'
import type { ImageLoader } from './useImageLoader'
import {
  CARD_SIZE,
  CELL_SIZE,
  COLORS,
  getCardPosition,
  getVisibleTiles,
  getPlaceholderColor,
  worldToScreen,
} from './canvas-utils'

const CARD_RADIUS = 8
const TEXT_PADDING = 8
const TITLE_FONT_SIZE = 12
const MIN_ZOOM_FOR_TEXT = 0.3
const FILTERED_OPACITY = 0.06

export interface CanvasRenderer {
  render: (
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
    hoveredIndex: number | null
  ) => void
}

export function useCanvasRenderer(
  state: CanvasState,
  imageLoader: ImageLoader
): CanvasRenderer {
  const render = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      viewportWidth: number,
      viewportHeight: number,
      hoveredIndex: number | null
    ) => {
      const { cameraRef, zoomRef, gridConfig, concepts, filteredIndices } = state
      const camera = cameraRef.current
      const zoom = zoomRef.current

      // Clear canvas
      ctx.fillStyle = COLORS.background
      ctx.fillRect(0, 0, viewportWidth, viewportHeight)

      // Get visible tiles
      const visibleTiles = getVisibleTiles(
        camera,
        zoom,
        viewportWidth,
        viewportHeight,
        gridConfig
      )

      // Render each tile
      for (const { tileX, tileY } of visibleTiles) {
        const tileOffsetX = tileX * gridConfig.tileWidth
        const tileOffsetY = tileY * gridConfig.tileHeight

        // Render each card in this tile
        for (let i = 0; i < concepts.length; i++) {
          const concept = concepts[i]
          const cardPos = getCardPosition(i, gridConfig)

          // World position of this card instance
          const worldX = tileOffsetX + cardPos.x
          const worldY = tileOffsetY + cardPos.y

          // Convert to screen coordinates
          const screen = worldToScreen(
            worldX,
            worldY,
            camera,
            zoom,
            viewportWidth,
            viewportHeight
          )

          const cardScreenSize = CARD_SIZE * zoom

          // Cull cards outside viewport (with margin)
          if (
            screen.x + cardScreenSize < -50 ||
            screen.x > viewportWidth + 50 ||
            screen.y + cardScreenSize < -50 ||
            screen.y > viewportHeight + 50
          ) {
            continue
          }

          // Determine opacity based on filter
          const isFiltered = filteredIndices.size < concepts.length
          const isVisible = filteredIndices.has(i)
          const opacity = isFiltered && !isVisible ? FILTERED_OPACITY : 1

          // Check hover state
          const isHovered = hoveredIndex === i

          // Request image load with priority based on distance from center
          const dx = screen.x + cardScreenSize / 2 - viewportWidth / 2
          const dy = screen.y + cardScreenSize / 2 - viewportHeight / 2
          const priority = Math.sqrt(dx * dx + dy * dy)
          imageLoader.loadImage(concept.image_url, priority)

          // Draw card
          renderCard(
            ctx,
            concept,
            screen.x,
            screen.y,
            cardScreenSize,
            zoom,
            opacity,
            isHovered,
            imageLoader
          )
        }
      }
    },
    [state, imageLoader]
  )

  return { render }
}

function renderCard(
  ctx: CanvasRenderingContext2D,
  concept: Concept,
  x: number,
  y: number,
  size: number,
  zoom: number,
  opacity: number,
  isHovered: boolean,
  imageLoader: ImageLoader
) {
  ctx.save()
  ctx.globalAlpha = opacity

  const radius = CARD_RADIUS * zoom

  // Draw card background
  ctx.fillStyle = isHovered ? '#1A1A1A' : COLORS.card
  ctx.beginPath()
  roundRect(ctx, x, y, size, size, radius)
  ctx.fill()

  // Draw border
  if (isHovered) {
    ctx.strokeStyle = '#333333'
    ctx.lineWidth = 2 * zoom
    ctx.stroke()
  }

  // Draw image or placeholder
  const image = imageLoader.getImage(concept.image_url)
  const imagePadding = 0
  const imageSize = size - imagePadding * 2
  const imageX = x + imagePadding
  const imageY = y + imagePadding

  if (image) {
    // Calculate aspect ratio fit
    const imgAspect = image.width / image.height
    const cardAspect = 1 // Square card

    let drawWidth = imageSize
    let drawHeight = imageSize
    let drawX = imageX
    let drawY = imageY

    if (imgAspect > cardAspect) {
      // Image is wider, fit to height
      drawHeight = imageSize
      drawWidth = imageSize * imgAspect
      drawX = imageX - (drawWidth - imageSize) / 2
    } else {
      // Image is taller, fit to width
      drawWidth = imageSize
      drawHeight = imageSize / imgAspect
      drawY = imageY - (drawHeight - imageSize) / 2
    }

    // Clip to card bounds
    ctx.save()
    ctx.beginPath()
    roundRect(ctx, imageX, imageY, imageSize, imageSize, radius)
    ctx.clip()

    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
    ctx.restore()
  } else {
    // Draw placeholder
    ctx.fillStyle = getPlaceholderColor(concept.id)
    ctx.beginPath()
    roundRect(ctx, imageX, imageY, imageSize, imageSize, radius)
    ctx.fill()

    // Show loading indicator
    if (imageLoader.isLoading(concept.image_url)) {
      ctx.fillStyle = COLORS.mutedText
      ctx.font = `${Math.max(10, 14 * zoom)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('...', x + size / 2, y + size / 2)
    }
  }

  // Draw title (only at higher zoom levels)
  if (zoom >= MIN_ZOOM_FOR_TEXT) {
    const textY = y + size - TEXT_PADDING * zoom
    const fontSize = Math.max(8, TITLE_FONT_SIZE * zoom)

    ctx.fillStyle = COLORS.text
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'

    // Truncate title if too long
    const maxWidth = size - TEXT_PADDING * 2 * zoom
    const title = truncateText(ctx, concept.title, maxWidth)

    // Draw text shadow for readability
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillText(title, x + TEXT_PADDING * zoom + 1, textY + 1)

    ctx.fillStyle = COLORS.text
    ctx.fillText(title, x + TEXT_PADDING * zoom, textY)
  }

  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  const measured = ctx.measureText(text)
  if (measured.width <= maxWidth) return text

  let truncated = text
  while (truncated.length > 0) {
    truncated = truncated.slice(0, -1)
    if (ctx.measureText(truncated + '...').width <= maxWidth) {
      return truncated + '...'
    }
  }
  return '...'
}
