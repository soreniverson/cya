/**
 * Canvas coverage + stability matrix.
 *
 * Exercises the real canvas maths across every viewport we plausibly ship to,
 * at every zoom level, and asserts the two properties that produce the
 * "images won't load" and "images flicker" symptoms:
 *
 *   COVERAGE  every cell the viewport can see is given a card. A card that is
 *             dropped from the visible set is never passed to requestLoad, so
 *             it stays permanently blank while the loader reports itself idle.
 *
 *   STABILITY the set of cards is stable across consecutive frames at a fixed
 *             viewport. Churn means cards are released and re-acquired, and a
 *             re-acquired card resets imageAlpha to 0 - which is a visible flash.
 *
 * Run: npx tsx scripts/canvas-matrix-test.ts
 */
import {
  computeGridConfig,
  getVisibleCards,
  getMaxVisibleCards,
  getCardKey,
  getThumbUrl,
  hitTestCard,
  CELL_SIZE,
  CARD_SIZE,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  MAX_VISIBLE_CARDS_CEILING,
  type GridConfig,
  type Viewport,
} from '../src/components/canvas/canvas-utils'
import type { CanvasConcept } from '../src/lib/types'

const CONCEPT_COUNT = 964

const DEVICES: Array<[string, number, number]> = [
  ['iPhone SE', 375, 667],
  ['iPhone 13 mini', 375, 812],
  ['iPhone 15', 393, 852],
  ['iPhone 15 Pro Max', 430, 932],
  ['Pixel 8', 412, 915],
  ['Galaxy S24 Ultra', 384, 824],
  ['iPad mini', 744, 1133],
  ['iPad Pro 11', 834, 1194],
  ['iPad Pro 12.9', 1024, 1366],
  ['Surface Pro', 1368, 912],
  ['MacBook Air 13', 1470, 956],
  ['MacBook Pro 14', 1512, 982],
  ['MacBook Pro 16', 1728, 1117],
  ['Soren, sidebar open', 1680, 1210],
  ['1080p full screen', 1920, 1080],
  ['Studio Display', 2560, 1440],
  ['Ultrawide 34"', 3440, 1440],
  ['4K full screen', 3840, 2160],
  ['Pro Display XDR', 6016, 3384],
]

const ZOOMS = [MIN_ZOOM, 0.28, DEFAULT_ZOOM, 0.35, 0.45, 0.5, 0.75, 1.0, 1.5, MAX_ZOOM]

// Pan positions worth probing: grid centre, a tile seam, deep in a negative
// tile, and a spot chosen to straddle the trailing partial row.
function panPositions(cfg: GridConfig): Array<[string, number, number]> {
  return [
    ['centre', cfg.tileWidth / 2, cfg.tileHeight / 2],
    ['tile seam', cfg.tileWidth, cfg.tileHeight],
    ['negative tile', -cfg.tileWidth * 1.5, -cfg.tileHeight * 0.5],
    ['trailing row', cfg.tileWidth / 2, cfg.tileHeight - CELL_SIZE],
    ['far tile', cfg.tileWidth * 7.25, cfg.tileHeight * 3.75],
  ]
}

const concepts: CanvasConcept[] = Array.from({ length: CONCEPT_COUNT }, (_, i) => ({
  id: `id-${i}`,
  slug: `slug-${i}`,
  title: `Concept ${i}`,
  caption: null,
  image_url: `orig-${i}.png`,
  thumbnail_url: `thumbnails/thumb-${i}.jpg`,
  mid_url: `mid/mid-${i}.jpg`, atlas_slot: i,
  category: i % 5 === 0 ? `cat-${i % 60}` : null,
  date_posted: '2025-01-01',
}))

const cfg = computeGridConfig(CONCEPT_COUNT)

/** Cells the viewport genuinely covers, independent of any cap. */
function cellsCovered(vp: Viewport): number {
  const halfW = vp.width / 2 / vp.zoom
  const halfH = vp.height / 2 / vp.zoom
  const margin = CELL_SIZE
  const left = vp.pan.x - halfW - margin
  const right = vp.pan.x + halfW + margin
  const top = vp.pan.y - halfH - margin
  const bottom = vp.pan.y + halfH + margin
  const cols = Math.floor(right / CELL_SIZE) - Math.floor(left / CELL_SIZE) + 1
  const rows = Math.floor(bottom / CELL_SIZE) - Math.floor(top / CELL_SIZE) + 1
  return cols * rows
}

/** Cells actually on screen, excluding the off-screen margin ring. */
function cellsOnScreen(vp: Viewport): number {
  const cell = CELL_SIZE * vp.zoom
  return Math.ceil(vp.width / cell) * Math.ceil(vp.height / cell)
}

interface Failure { kind: string; detail: string }
const failures: Failure[] = []
let checks = 0
let worstFrameMs = 0
let maxCardsSeen = 0
let maxUniqueTextures = 0

for (const [device, width, height] of DEVICES) {
  for (const zoom of ZOOMS) {
    for (const [panLabel, panX, panY] of panPositions(cfg)) {
      checks++
      const vp: Viewport = { pan: { x: panX, y: panY }, zoom, width, height }

      const t0 = process.hrtime.bigint()
      const visible = getVisibleCards(vp, cfg, concepts)
      worstFrameMs = Math.max(worstFrameMs, Number(process.hrtime.bigint() - t0) / 1e6)

      const wanted = cellsCovered(vp)
      const cap = getMaxVisibleCards(zoom, width, height)
      maxCardsSeen = Math.max(maxCardsSeen, visible.length)

      const where = `${device} ${width}x${height} @ zoom ${zoom} (${panLabel})`

      // COVERAGE: nothing on screen may be dropped. Deliberately checked
      // against the ceiling too - "we hit the safety limit" is not an excuse
      // for a permanently blank tile.
      const onScreen = cellsOnScreen(vp)
      if (visible.length < onScreen) {
        failures.push({
          kind: 'DROPPED',
          detail: `${where}: ${onScreen} cells on screen, only ${visible.length} drawn (cap ${cap}, wanted ${wanted}) -> ${onScreen - visible.length} permanently blank`,
        })
      }

      // Every visible card must resolve to a usable texture URL.
      const urls = new Set<string>()
      for (const card of visible) {
        if (!card.concept) {
          failures.push({ kind: 'NO_CONCEPT', detail: `${where}: card index ${card.index} has no concept` })
          break
        }
        const u = getThumbUrl(card.concept)
        if (!u || u.endsWith('undefined') || u.endsWith('null')) {
          failures.push({ kind: 'BAD_URL', detail: `${where}: card index ${card.index} -> ${u}` })
          break
        }
        urls.add(u)
      }
      maxUniqueTextures = Math.max(maxUniqueTextures, urls.size)

      // STABILITY: at a fixed viewport, consecutive frames must produce the
      // same card keys. Any difference means release/re-acquire, i.e. a flash.
      const keysA = new Set(visible.map((c) => getCardKey(c.index, c.tileX, c.tileY)))
      const keysB = new Set(getVisibleCards(vp, cfg, concepts).map((c) => getCardKey(c.index, c.tileX, c.tileY)))
      if (keysA.size !== keysB.size || [...keysA].some((k) => !keysB.has(k))) {
        failures.push({ kind: 'CHURN_STATIC', detail: `${where}: card set unstable at a fixed viewport` })
      }

      // STABILITY under a 1px drift, as during momentum. Some turnover is
      // expected at the edges; a large fraction means the cap is reshuffling.
      const drift: Viewport = { ...vp, pan: { x: panX + 1, y: panY + 1 } }
      const keysC = new Set(getVisibleCards(drift, cfg, concepts).map((c) => getCardKey(c.index, c.tileX, c.tileY)))
      const lost = [...keysA].filter((k) => !keysC.has(k)).length
      const churn = keysA.size ? lost / keysA.size : 0
      if (churn > 0.1) {
        failures.push({
          kind: 'CHURN_DRIFT',
          detail: `${where}: ${(churn * 100).toFixed(0)}% of cards released after a 1px pan (flicker)`,
        })
      }

      // Anything drawn must also be clickable, and must resolve to the concept
      // that was drawn there.
      const probe = visible[Math.floor(visible.length / 2)]
      if (probe) {
        const cx = (probe.worldX + CARD_SIZE / 2 - vp.pan.x) * zoom + width / 2
        const cy = (probe.worldY + CARD_SIZE / 2 - vp.pan.y) * zoom + height / 2
        if (cx >= 0 && cy >= 0 && cx <= width && cy <= height) {
          const hit = hitTestCard(cx, cy, vp, cfg, concepts)
          if (!hit) {
            failures.push({ kind: 'DEAD_CARD', detail: `${where}: drawn card at index ${probe.index} is not clickable` })
          } else if (hit.concept.id !== probe.concept.id) {
            failures.push({
              kind: 'WRONG_CARD',
              detail: `${where}: drew ${probe.concept.id} but click returns ${hit.concept.id}`,
            })
          }
        }
      }
    }
  }
}

// Degenerate inputs must not hang or throw.
for (const [label, count] of [['empty archive', 0], ['single concept', 1]] as const) {
  const c = computeGridConfig(count)
  const subset = concepts.slice(0, count)
  const started = Date.now()
  const out = getVisibleCards({ pan: { x: 0, y: 0 }, zoom: DEFAULT_ZOOM, width: 1920, height: 1080 }, c, subset)
  if (Date.now() - started > 500) failures.push({ kind: 'HANG', detail: `${label}: getVisibleCards took too long` })
  if (count === 0 && out.length !== 0) failures.push({ kind: 'EMPTY', detail: `${label}: expected 0 cards` })
  checks++
}

const byKind = failures.reduce<Record<string, number>>((a, f) => ((a[f.kind] = (a[f.kind] ?? 0) + 1), a), {})

console.log(`\n  devices          ${DEVICES.length}`)
console.log(`  zoom levels      ${ZOOMS.length}`)
console.log(`  pan positions    ${panPositions(cfg).length}`)
console.log(`  combinations     ${checks}`)
console.log(`  max cards drawn  ${maxCardsSeen}  (ceiling ${MAX_VISIBLE_CARDS_CEILING})`)
console.log(`  max unique texts ${maxUniqueTextures}`)
console.log(`  worst frame      ${worstFrameMs.toFixed(2)} ms`)

if (failures.length === 0) {
  console.log(`\n  PASS - no dropped, unstable, dead or mis-targeted cards\n`)
  process.exit(0)
}

console.log(`\n  FAIL - ${failures.length} problem(s): ${JSON.stringify(byKind)}\n`)
const shown = new Set<string>()
for (const f of failures) {
  if (shown.has(f.kind) && shown.size > 0 && failures.filter((x) => x.kind === f.kind).length > 3) {
    if ([...shown].filter((k) => k === f.kind).length > 3) continue
  }
  console.log(`    [${f.kind}] ${f.detail}`)
  shown.add(f.kind)
}
process.exit(1)
