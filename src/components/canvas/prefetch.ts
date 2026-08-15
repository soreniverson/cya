import {
  CELL_SIZE,
  MAX_VISIBLE_CARDS_CEILING,
  getThumbUrl,
  getMidUrl,
  LOD,
  type GridConfig,
  type Viewport,
} from './canvas-utils'
import type { CanvasConcept } from '@/lib/types'

/**
 * Request tiers. The tier dominates ordering; distance from the viewport
 * centre only breaks ties within a tier. Encoded into a single number so the
 * queue can sort on one comparison.
 */
export const TIER = {
  VISIBLE: 0, // on screen right now, missing a texture
  PREDICTED: 1, // where the camera is heading, or the zoom it is settling on
  OVERSCAN: 2, // one viewport of margin in every direction
  BACKGROUND: 3, // the rest of the archive, pulled in during idle time
} as const

export type Tier = (typeof TIER)[keyof typeof TIER]

const TIER_STRIDE = 1_000_000

export function priorityOf(tier: Tier, distanceFromCentre: number): number {
  // distance is squared screen px; compress so it can never bleed into the
  // next tier even on an enormous canvas.
  return tier * TIER_STRIDE + Math.min(TIER_STRIDE - 1, Math.round(distanceFromCentre / 1000))
}

export function tierOfPriority(priority: number): Tier {
  return Math.floor(priority / TIER_STRIDE) as Tier
}

/** Camera motion, used to aim the predicted tier. */
export interface Motion {
  /** World units per frame. */
  vx: number
  vy: number
  /** Zoom the camera is animating toward, which may differ from current. */
  targetZoom: number
  /** True while dragging/pinching/animating - prediction is only useful then. */
  isMoving: boolean
}

export const STILL: Motion = { vx: 0, vy: 0, targetZoom: 0, isMoving: false }

/**
 * How aggressively to prefetch. Pulling the whole archive is ~3 MB, which is
 * free on wifi and rude on a metered connection, so the depth is chosen from
 * the Network Information API where it exists.
 */
export type PrefetchDepth = 'full' | 'nearby' | 'minimal'

export function depthFromConnection(): PrefetchDepth {
  if (typeof navigator === 'undefined') return 'full'
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection
  if (!conn) return 'full'
  if (conn.saveData) return 'minimal'
  if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 'minimal'
  if (conn.effectiveType === '3g') return 'nearby'
  return 'full'
}

export interface PlanEntry {
  url: string
  priority: number
  tier: Tier
}

/**
 * Per-tier caps. Visible is bounded by the render ceiling; the rest exist so a
 * huge display at minimum zoom cannot enqueue tens of thousands of entries.
 * They are generous because the archive only holds 964 unique thumbnails, so
 * these limits are almost never the binding constraint in practice.
 */
const TIER_CAP: Record<Tier, number> = {
  [TIER.VISIBLE]: MAX_VISIBLE_CARDS_CEILING,
  [TIER.PREDICTED]: 1500,
  [TIER.OVERSCAN]: 2500,
  [TIER.BACKGROUND]: 4000,
}

/** How far ahead of the camera to aim the predicted tier, in frames of travel. */
const PREDICT_FRAMES = 45

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

function viewportRect(vp: Viewport, zoom: number, cx: number, cy: number, expand: number): Rect {
  const halfW = (vp.width / 2 / zoom) * expand
  const halfH = (vp.height / 2 / zoom) * expand
  return { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH }
}

/**
 * Walk the cells covered by a world-space rect, calling back with the concept
 * index and its squared distance from the viewport centre. Deliberately does
 * not allocate card objects - this runs over several rings per viewport change.
 */
function forEachCellIn(
  rect: Rect,
  cfg: GridConfig,
  conceptCount: number,
  centreX: number,
  centreY: number,
  limit: number,
  visit: (conceptIndex: number, distSq: number) => void
): void {
  if (conceptCount === 0 || !(cfg.tileWidth > 0) || !(cfg.tileHeight > 0)) return

  const startCol = Math.floor(rect.left / CELL_SIZE)
  const endCol = Math.floor(rect.right / CELL_SIZE)
  const startRow = Math.floor(rect.top / CELL_SIZE)
  const endRow = Math.floor(rect.bottom / CELL_SIZE)

  let seen = 0
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      if (seen >= limit) return
      seen++

      const worldX = col * CELL_SIZE
      const worldY = row * CELL_SIZE

      // Wrap into tile space exactly as the renderer does.
      const localCol = ((col % cfg.cols) + cfg.cols) % cfg.cols
      const localRow = ((row % cfg.rows) + cfg.rows) % cfg.rows
      const index = localRow * cfg.cols + localCol
      const conceptIndex = index % conceptCount

      const dx = worldX + CELL_SIZE / 2 - centreX
      const dy = worldY + CELL_SIZE / 2 - centreY
      visit(conceptIndex, dx * dx + dy * dy)
    }
  }
}

/**
 * Build the full ordered set of URLs worth having in memory for this viewport
 * and this camera motion.
 *
 * The old loader only ever asked for cards that were already on screen, so a
 * tile could not begin loading until it was visible - which is precisely when
 * it is too late. This computes the visible set, the region the camera is
 * heading for, a ring of overscan, and finally the rest of the archive as a
 * a ring of overscan, and then the rest of the archive during idle time.
 */
export function buildPrefetchPlan(
  vp: Viewport,
  motion: Motion,
  cfg: GridConfig,
  concepts: CanvasConcept[],
  depth: PrefetchDepth = 'full'
): PlanEntry[] {
  const out: PlanEntry[] = []
  const at = new Map<string, number>() // url -> index in `out`

  if (concepts.length === 0 || !(vp.zoom > 0) || !(vp.width > 0) || !(vp.height > 0)) {
    return out
  }

  const wantMid = vp.zoom >= LOD.LOAD_MID_RES

  const add = (conceptIndex: number, distSq: number, tier: Tier) => {
    const concept = concepts[conceptIndex]
    if (!concept) return
    const priority = priorityOf(tier, distSq)

    const url = getThumbUrl(concept)
    const existing = at.get(url)
    if (existing === undefined) {
      at.set(url, out.length)
      out.push({ url, priority, tier })
    } else if (priority < out[existing].priority) {
      // Seen again in a better tier or nearer the centre: upgrade in place
      // rather than emitting the URL twice.
      out[existing].priority = priority
      out[existing].tier = tier
    }

    // Mid-res only for tiers that are, or are about to be, on screen.
    if (wantMid && tier <= TIER.PREDICTED) {
      const midUrl = getMidUrl(concept)
      if (midUrl !== url) {
        const midAt = at.get(midUrl)
        if (midAt === undefined) {
          at.set(midUrl, out.length)
          out.push({ url: midUrl, priority, tier })
        } else if (priority < out[midAt].priority) {
          out[midAt].priority = priority
          out[midAt].tier = tier
        }
      }
    }
  }

  const cx = vp.pan.x
  const cy = vp.pan.y

  // Tier 0 - what is on screen now, plus the one-cell margin the renderer uses.
  const visibleRect = viewportRect(vp, vp.zoom, cx, cy, 1)
  visibleRect.left -= CELL_SIZE
  visibleRect.right += CELL_SIZE
  visibleRect.top -= CELL_SIZE
  visibleRect.bottom += CELL_SIZE
  forEachCellIn(visibleRect, cfg, concepts.length, cx, cy, TIER_CAP[TIER.VISIBLE], (i, d) =>
    add(i, d, TIER.VISIBLE)
  )

  // Tier 1 - where the camera is going.
  if (motion.isMoving) {
    // Panning: aim a viewport-sized box at the projected position.
    if (motion.vx !== 0 || motion.vy !== 0) {
      const aheadX = cx + motion.vx * PREDICT_FRAMES
      const aheadY = cy + motion.vy * PREDICT_FRAMES
      const r = viewportRect(vp, vp.zoom, aheadX, aheadY, 1.1)
      forEachCellIn(r, cfg, concepts.length, cx, cy, TIER_CAP[TIER.PREDICTED], (i, d) =>
        add(i, d, TIER.PREDICTED)
      )
    }
    // Zooming: the destination zoom exposes a different set of cells. Zooming
    // out is the dangerous direction - it can multiply the visible count - so
    // plan for the target rather than waiting for the animation to land.
    if (motion.targetZoom > 0 && Math.abs(motion.targetZoom - vp.zoom) > 0.005) {
      const r = viewportRect(vp, motion.targetZoom, cx, cy, 1.1)
      forEachCellIn(r, cfg, concepts.length, cx, cy, TIER_CAP[TIER.PREDICTED], (i, d) =>
        add(i, d, TIER.PREDICTED)
      )
    }
  }

  if (depth === 'minimal') return out

  // Tier 2 - a ring of one extra viewport in every direction, so a normal pan
  // lands on cards that are already textured.
  const overscan = viewportRect(vp, vp.zoom, cx, cy, 3)
  forEachCellIn(overscan, cfg, concepts.length, cx, cy, TIER_CAP[TIER.OVERSCAN], (i, d) =>
    add(i, d, TIER.OVERSCAN)
  )

  // Tier 3 - the rest of the archive.
  //
  // This is the whole game for a collection this size: 964 unique thumbnails,
  // ~3 MB of bytes, ~78 MB decoded. Once idle time has pulled them all in,
  // every subsequent pan and zoom is a cache hit. Eviction is not wasted work
  // either - the bytes stay in the browser's HTTP cache, so re-decoding an
  // evicted texture costs ~1.4 ms instead of a ~220 ms round trip.
  if (depth === 'full') {
    for (let i = 0; i < concepts.length && out.length < TIER_CAP[TIER.BACKGROUND]; i++) {
      add(i, TIER_STRIDE - 1, TIER.BACKGROUND)
    }
  }

  return out
}

/** Cells on screen right now, used by coverage measurement. */
export function visibleConceptIndices(
  vp: Viewport,
  cfg: GridConfig,
  conceptCount: number
): Set<number> {
  const set = new Set<number>()
  if (conceptCount === 0 || !(vp.zoom > 0)) return set
  const rect = viewportRect(vp, vp.zoom, vp.pan.x, vp.pan.y, 1)
  forEachCellIn(rect, cfg, conceptCount, vp.pan.x, vp.pan.y, MAX_VISIBLE_CARDS_CEILING, (i) => {
    set.add(i)
  })
  return set
}
