import type { Concept } from '@/lib/types'

// Grid configuration
export const CARD_SIZE = 240
export const CARD_GAP = 16
export const CELL_SIZE = CARD_SIZE + CARD_GAP
export const CARD_RADIUS = 8

// Zoom limits
export const MIN_ZOOM = 0.2  // ~10% on slider - don't zoom out further
export const MAX_ZOOM = 2.0
export const DEFAULT_ZOOM = 0.3 // Start slightly zoomed out

// LOD thresholds
export const LOD = {
  PLACEHOLDER_ONLY: 0.15,    // Below this: colored rectangles only
  SHOW_IMAGES: 0.15,         // Above this: load and show thumbnails
  SHOW_TITLE: 0.35,          // Above this: show title text
  SHOW_DATE: 0.5,            // Above this: show date text
} as const

// Momentum physics
export const FRICTION = 0.92 // Higher = more momentum (0.92 = smooth, controlled glide)
export const VELOCITY_STOP_THRESHOLD = 0.05 // Lower = smoother stop
export const DRAG_SAMPLE_WINDOW_MS = 100 // Sample window for velocity calculation

// Smooth zoom
export const ZOOM_LERP_SPEED = 0.15 // How fast zoom animates (0-1, higher = faster)

// Animation
export const SHUFFLE_DURATION = 600
export const RECENTER_DURATION = 500

// Image loading
export const MAX_CONCURRENT_LOADS = 8 // Reduced for smoother scrolling/zooming

// Theme colors
export const COLORS = {
  background: 0x0A0A0A,
  card: 0x171717,
  cardHover: 0x1A1A1A,
  text: 0xFAFAFA,
  mutedText: 0x888888,
  border: 0x1A1A1A,
} as const

const DEFAULT_CATEGORY_COLOR = 0x1E1E1E
const categoryColorCache = new Map<string, number>()

/**
 * Generate a consistent, muted color from a category name
 * Uses hue from string hash, with low saturation for subtle tones
 */
export function getCategoryColor(category: string | null): number {
  if (!category) return DEFAULT_CATEGORY_COLOR

  const cached = categoryColorCache.get(category)
  if (cached !== undefined) return cached

  // Simple hash of category name
  let hash = 0
  for (let i = 0; i < category.length; i++) {
    hash = ((hash << 5) - hash) + category.charCodeAt(i)
    hash = hash & hash
  }

  // Generate muted color: varied hue, low saturation (15-25%), low lightness (15-22%)
  const hue = Math.abs(hash) % 360
  const saturation = 15 + (Math.abs(hash >> 8) % 10) // 15-25%
  const lightness = 15 + (Math.abs(hash >> 16) % 7)  // 15-22%

  const color = hslToHex(hue, saturation, lightness)
  categoryColorCache.set(category, color)
  return color
}

function hslToHex(h: number, s: number, l: number): number {
  s /= 100
  l /= 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }

  const ri = Math.round((r + m) * 255)
  const gi = Math.round((g + m) * 255)
  const bi = Math.round((b + m) * 255)

  return (ri << 16) | (gi << 8) | bi
}

/**
 * Get the best image URL for the current zoom level
 * Prefers pre-generated thumbnails, falls back to original
 */
export function getImageUrl(
  imageUrl: string,
  thumbnailUrl: string | null | undefined,
  size: 'thumb' | 'full'
): string {
  // Use pre-generated thumbnail if available
  if (size === 'thumb' && thumbnailUrl) {
    return thumbnailUrl
  }
  return imageUrl
}

export interface GridConfig {
  cols: number
  rows: number
  tileWidth: number
  tileHeight: number
  totalConcepts: number
}

export interface Point {
  x: number
  y: number
}

export interface Viewport {
  pan: Point
  zoom: number
  width: number
  height: number
}

export interface VisibleCard {
  concept: Concept
  index: number
  worldX: number
  worldY: number
  tileX: number
  tileY: number
  screenX: number
  screenY: number
  screenSize: number
  distanceFromCenter: number
}

/**
 * Compute grid configuration based on concept count
 * Aims for a roughly square grid
 */
export function computeGridConfig(conceptCount: number): GridConfig {
  // Aim for ~30 columns, adjust rows accordingly
  const cols = Math.ceil(Math.sqrt(conceptCount * 1.2))
  const rows = Math.ceil(conceptCount / cols)

  return {
    cols,
    rows,
    tileWidth: cols * CELL_SIZE,
    tileHeight: rows * CELL_SIZE,
    totalConcepts: conceptCount,
  }
}

/**
 * Get card position in world coordinates (within a single tile)
 */
export function getCardWorldPosition(index: number, config: GridConfig): Point {
  const col = index % config.cols
  const row = Math.floor(index / config.cols)
  return {
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
  }
}

/**
 * Get the center of the grid (for initial camera position)
 */
export function getGridCenter(config: GridConfig): Point {
  return {
    x: config.tileWidth / 2,
    y: config.tileHeight / 2,
  }
}

/**
 * Get a random position in the grid (for shuffle)
 */
export function getRandomGridPosition(config: GridConfig): Point {
  const randomIndex = Math.floor(Math.random() * config.totalConcepts)
  const pos = getCardWorldPosition(randomIndex, config)
  return {
    x: pos.x + CARD_SIZE / 2,
    y: pos.y + CARD_SIZE / 2,
  }
}

/**
 * Clamp zoom to valid range
 */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

/**
 * Easing function: ease-out cubic
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Convert world coordinates to screen coordinates
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  viewport: Viewport
): Point {
  return {
    x: (worldX - viewport.pan.x) * viewport.zoom + viewport.width / 2,
    y: (worldY - viewport.pan.y) * viewport.zoom + viewport.height / 2,
  }
}

/**
 * Convert screen coordinates to world coordinates
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: Viewport
): Point {
  return {
    x: viewport.pan.x + (screenX - viewport.width / 2) / viewport.zoom,
    y: viewport.pan.y + (screenY - viewport.height / 2) / viewport.zoom,
  }
}

/**
 * Calculate new pan position when zooming toward a point
 * The point under the cursor stays fixed as zoom changes
 */
export function zoomTowardPoint(
  currentPan: Point,
  currentZoom: number,
  newZoom: number,
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number
): Point {
  // Point in world space before zoom
  const worldX = currentPan.x + (screenX - viewportWidth / 2) / currentZoom
  const worldY = currentPan.y + (screenY - viewportHeight / 2) / currentZoom

  // Adjust pan so the same world point stays under the cursor
  return {
    x: worldX - (screenX - viewportWidth / 2) / newZoom,
    y: worldY - (screenY - viewportHeight / 2) / newZoom,
  }
}

/**
 * Normalize a value to the tile space using modular arithmetic
 */
function normalizeToTile(value: number, tileSize: number): number {
  const mod = ((value % tileSize) + tileSize) % tileSize
  return mod
}

/**
 * Get all visible cards for the current viewport
 * Infinite tiling - grid repeats seamlessly in all directions
 * Empty grid cells (beyond concept count) render as placeholders
 */
export function getVisibleCards(
  viewport: Viewport,
  config: GridConfig,
  concepts: Concept[]
): VisibleCard[] {
  const visible: VisibleCard[] = []

  // Calculate world bounds of viewport with margin
  const halfViewW = viewport.width / 2 / viewport.zoom
  const halfViewH = viewport.height / 2 / viewport.zoom
  const margin = CELL_SIZE

  const worldLeft = viewport.pan.x - halfViewW - margin
  const worldRight = viewport.pan.x + halfViewW + margin
  const worldTop = viewport.pan.y - halfViewH - margin
  const worldBottom = viewport.pan.y + halfViewH + margin

  const screenCenterX = viewport.width / 2
  const screenCenterY = viewport.height / 2
  const cardScreenSize = CARD_SIZE * viewport.zoom

  // Find which tiles are visible (infinite tiling)
  const startTileX = Math.floor(worldLeft / config.tileWidth)
  const endTileX = Math.floor(worldRight / config.tileWidth)
  const startTileY = Math.floor(worldTop / config.tileHeight)
  const endTileY = Math.floor(worldBottom / config.tileHeight)

  // For each visible tile
  for (let tileY = startTileY; tileY <= endTileY; tileY++) {
    for (let tileX = startTileX; tileX <= endTileX; tileX++) {
      const tileOffsetX = tileX * config.tileWidth
      const tileOffsetY = tileY * config.tileHeight

      // Calculate visible column/row range within this tile
      const localLeft = worldLeft - tileOffsetX
      const localRight = worldRight - tileOffsetX
      const localTop = worldTop - tileOffsetY
      const localBottom = worldBottom - tileOffsetY

      const startCol = Math.max(0, Math.floor(localLeft / CELL_SIZE))
      const endCol = Math.min(config.cols - 1, Math.floor(localRight / CELL_SIZE))
      const startRow = Math.max(0, Math.floor(localTop / CELL_SIZE))
      const endRow = Math.min(config.rows - 1, Math.floor(localBottom / CELL_SIZE))

      // Iterate visible cells in this tile
      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          const index = row * config.cols + col

          // World position includes tile offset
          const worldX = tileOffsetX + col * CELL_SIZE
          const worldY = tileOffsetY + row * CELL_SIZE

          // Convert to screen coordinates
          const screenX = (worldX - viewport.pan.x) * viewport.zoom + screenCenterX
          const screenY = (worldY - viewport.pan.y) * viewport.zoom + screenCenterY

          // Calculate distance from center (squared is fine for comparison)
          const dx = screenX + cardScreenSize / 2 - screenCenterX
          const dy = screenY + cardScreenSize / 2 - screenCenterY

          // Wrap index to reuse concepts for seamless infinite tiling
          const concept = concepts[index % concepts.length]

          visible.push({
            concept,
            index,
            worldX,
            worldY,
            tileX,
            tileY,
            screenX,
            screenY,
            screenSize: cardScreenSize,
            distanceFromCenter: dx * dx + dy * dy,
          })
        }
      }
    }
  }

  return visible
}

/**
 * Hit test: find which card is at screen coordinates
 * Uses grid math instead of iterating all sprites
 * Works with infinite tiling via modular arithmetic
 */
export function hitTestCard(
  screenX: number,
  screenY: number,
  viewport: Viewport,
  config: GridConfig,
  concepts: Concept[]
): { concept: Concept; index: number } | null {
  // Convert screen to world
  const world = screenToWorld(screenX, screenY, viewport)

  // Normalize to tile space using modular arithmetic (infinite tiling)
  const localX = normalizeToTile(world.x, config.tileWidth)
  const localY = normalizeToTile(world.y, config.tileHeight)

  // Find which cell we're in
  const col = Math.floor(localX / CELL_SIZE)
  const row = Math.floor(localY / CELL_SIZE)

  // Check if we're actually over a card (not the gap)
  const cellX = localX % CELL_SIZE
  const cellY = localY % CELL_SIZE

  if (cellX > CARD_SIZE || cellY > CARD_SIZE) {
    return null // In the gap
  }

  const index = row * config.cols + col
  if (index >= concepts.length) {
    return null // Empty grid cell (beyond concept array)
  }

  return {
    concept: concepts[index],
    index,
  }
}

/**
 * Generate a unique key for a visible card (for sprite pooling)
 */
export function getCardKey(index: number, tileX: number, tileY: number): string {
  return `${index}-${tileX}-${tileY}`
}

/**
 * Get LOD level for current zoom
 */
export function getLODLevel(zoom: number): 'placeholder' | 'image' | 'title' | 'full' {
  if (zoom < LOD.PLACEHOLDER_ONLY) return 'placeholder'
  if (zoom < LOD.SHOW_TITLE) return 'image'
  if (zoom < LOD.SHOW_DATE) return 'title'
  return 'full'
}

/**
 * Convert zoom (0.05-2) to percent (0-100) for slider
 */
export function zoomToPercent(zoom: number): number {
  return Math.round(((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100)
}

/**
 * Convert percent (0-100) to zoom (0.05-2) for slider
 */
export function percentToZoom(percent: number): number {
  return MIN_ZOOM + (percent / 100) * (MAX_ZOOM - MIN_ZOOM)
}
