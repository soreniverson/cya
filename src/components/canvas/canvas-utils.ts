import type { Concept } from '@/lib/types'

// Grid configuration
export const CARD_SIZE = 200
export const CARD_GAP = 16
export const CELL_SIZE = CARD_SIZE + CARD_GAP
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 2
export const FRICTION = 0.95
export const VELOCITY_THRESHOLD = 0.1

// Theme colors (from globals.css)
export const COLORS = {
  background: '#0A0A0A',
  card: '#111111',
  text: '#FAFAFA',
  mutedText: '#888888',
  border: '#1A1A1A',
} as const

export interface GridConfig {
  cols: number
  rows: number
  tileWidth: number
  tileHeight: number
  totalConcepts: number
}

export interface Camera {
  x: number
  y: number
}

export interface CardHit {
  concept: Concept
  index: number
  worldX: number
  worldY: number
}

export function computeGridConfig(conceptCount: number): GridConfig {
  const cols = Math.ceil(Math.sqrt(conceptCount * 1.5))
  const rows = Math.ceil(conceptCount / cols)

  return {
    cols,
    rows,
    tileWidth: cols * CELL_SIZE,
    tileHeight: rows * CELL_SIZE,
    totalConcepts: conceptCount,
  }
}

// Easing functions
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// Convert screen coordinates to world coordinates
export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: Camera,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  return {
    x: camera.x + (screenX - viewportWidth / 2) / zoom,
    y: camera.y + (screenY - viewportHeight / 2) / zoom,
  }
}

// Convert world coordinates to screen coordinates
export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: Camera,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  return {
    x: (worldX - camera.x) * zoom + viewportWidth / 2,
    y: (worldY - camera.y) * zoom + viewportHeight / 2,
  }
}

// Get card position in world coordinates (within a single tile)
export function getCardPosition(
  index: number,
  gridConfig: GridConfig
): { x: number; y: number } {
  const col = index % gridConfig.cols
  const row = Math.floor(index / gridConfig.cols)
  return {
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
  }
}

// Normalize a value to the tile space using modular arithmetic
function normalizeToTile(value: number, tileSize: number): number {
  const mod = value % tileSize
  return mod < 0 ? mod + tileSize : mod
}

// Hit test: find which card (if any) is at the given screen coordinates
export function hitTestCard(
  screenX: number,
  screenY: number,
  camera: Camera,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  gridConfig: GridConfig,
  concepts: Concept[]
): CardHit | null {
  const world = screenToWorld(screenX, screenY, camera, zoom, viewportWidth, viewportHeight)

  // Normalize to position within single tile
  const normalizedX = normalizeToTile(world.x, gridConfig.tileWidth)
  const normalizedY = normalizeToTile(world.y, gridConfig.tileHeight)

  // Find which cell we're in
  const col = Math.floor(normalizedX / CELL_SIZE)
  const row = Math.floor(normalizedY / CELL_SIZE)

  // Check if we're actually over a card (not the gap)
  const cellX = normalizedX % CELL_SIZE
  const cellY = normalizedY % CELL_SIZE

  if (cellX > CARD_SIZE || cellY > CARD_SIZE) {
    return null // In the gap
  }

  const index = row * gridConfig.cols + col
  if (index >= concepts.length) {
    return null // Beyond the concept array
  }

  const cardPos = getCardPosition(index, gridConfig)
  const tileX = Math.floor(world.x / gridConfig.tileWidth)
  const tileY = Math.floor(world.y / gridConfig.tileHeight)

  return {
    concept: concepts[index],
    index,
    worldX: tileX * gridConfig.tileWidth + cardPos.x,
    worldY: tileY * gridConfig.tileHeight + cardPos.y,
  }
}

// Compute which tiles are visible based on camera position and zoom
export function getVisibleTiles(
  camera: Camera,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  gridConfig: GridConfig
): Array<{ tileX: number; tileY: number }> {
  const halfViewW = viewportWidth / 2 / zoom
  const halfViewH = viewportHeight / 2 / zoom

  const leftTile = Math.floor((camera.x - halfViewW) / gridConfig.tileWidth)
  const rightTile = Math.floor((camera.x + halfViewW) / gridConfig.tileWidth)
  const topTile = Math.floor((camera.y - halfViewH) / gridConfig.tileHeight)
  const bottomTile = Math.floor((camera.y + halfViewH) / gridConfig.tileHeight)

  const tiles: Array<{ tileX: number; tileY: number }> = []

  for (let ty = topTile; ty <= bottomTile; ty++) {
    for (let tx = leftTile; tx <= rightTile; tx++) {
      tiles.push({ tileX: tx, tileY: ty })
    }
  }

  return tiles
}

// Generate a deterministic color from an ID (for placeholder)
export function getPlaceholderColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash = hash & hash
  }

  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 30%, 20%)`
}

// Get the center position of the grid (for recenter)
export function getGridCenter(gridConfig: GridConfig): Camera {
  return {
    x: gridConfig.tileWidth / 2,
    y: gridConfig.tileHeight / 2,
  }
}

// Get a random position in the grid (for shuffle)
export function getRandomGridPosition(gridConfig: GridConfig): Camera {
  const randomIndex = Math.floor(Math.random() * gridConfig.totalConcepts)
  const pos = getCardPosition(randomIndex, gridConfig)
  return {
    x: pos.x + CARD_SIZE / 2,
    y: pos.y + CARD_SIZE / 2,
  }
}

// Clamp zoom to valid range
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

// Calculate new camera position when zooming toward a point
export function zoomTowardPoint(
  currentCamera: Camera,
  currentZoom: number,
  newZoom: number,
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number
): Camera {
  // Point in world space before zoom
  const worldX = currentCamera.x + (screenX - viewportWidth / 2) / currentZoom
  const worldY = currentCamera.y + (screenY - viewportHeight / 2) / currentZoom

  // Adjust camera so the same world point stays under the cursor
  return {
    x: worldX - (screenX - viewportWidth / 2) / newZoom,
    y: worldY - (screenY - viewportHeight / 2) / newZoom,
  }
}
