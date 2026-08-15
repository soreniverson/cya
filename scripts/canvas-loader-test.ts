/**
 * Regression tests for the prefetch/loading pipeline.
 *
 * These exist because the failure mode is silent: a tile that was never
 * requested looks identical to one that is still loading, and the loader
 * reports itself perfectly healthy in both cases.
 *
 * Since thumbnails moved into the atlas, the prefetch planner is responsible
 * only for mid-res imagery and for concepts uploaded since the last atlas
 * build. The single most important property is now the inverse of what it used
 * to be: a concept WITH an atlas slot must generate no thumbnail request at
 * all.
 *
 * Run: npx tsx scripts/canvas-loader-test.ts
 */
import {
  computeGridConfig,
  getThumbUrl,
  getMidUrl,
  MIN_ZOOM,
  DEFAULT_ZOOM,
  type Viewport,
} from '../src/components/canvas/canvas-utils'
import {
  buildPrefetchPlan,
  visibleConceptIndices,
  priorityOf,
  tierOfPriority,
  TIER,
  STILL,
  type Motion,
} from '../src/components/canvas/prefetch'
import type { CanvasConcept } from '../src/lib/types'

const N = 964
const concepts: CanvasConcept[] = Array.from({ length: N }, (_, i) => ({
  id: `id-${i}`, slug: `s-${i}`, title: `T${i}`, caption: null,
  image_url: `o-${i}.png`, thumbnail_url: `thumbnails/t-${i}.jpg`, mid_url: `mid/m-${i}.jpg`, atlas_slot: i,
  category: null, date_posted: '2025-01-01',
}))
const cfg = computeGridConfig(N)

let passed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++
  else failures.push(`${name}${detail ? ' — ' + detail : ''}`)
}
function vpAt(w: number, h: number, zoom: number, x = cfg.tileWidth / 2, y = cfg.tileHeight / 2): Viewport {
  return { pan: { x, y }, zoom, width: w, height: h }
}

// ---------------------------------------------------------------- priorities
{
  check('priority: tiers never overlap',
    priorityOf(TIER.VISIBLE, 1e12) < priorityOf(TIER.PREDICTED, 0) &&
    priorityOf(TIER.PREDICTED, 1e12) < priorityOf(TIER.OVERSCAN, 0) &&
    priorityOf(TIER.OVERSCAN, 1e12) < priorityOf(TIER.BACKGROUND, 0))
  check('priority: nearer sorts first within a tier',
    priorityOf(TIER.VISIBLE, 1000) < priorityOf(TIER.VISIBLE, 900000))
  check('priority: round-trips back to its tier',
    tierOfPriority(priorityOf(TIER.OVERSCAN, 5000)) === TIER.OVERSCAN)
}

// ------------------------------------------------- atlas replaces thumb work
const noSlot: CanvasConcept[] = concepts.map(c => ({ ...c, atlas_slot: null }))
{
  const vp = vpAt(1680, 1210, DEFAULT_ZOOM)

  // This is the whole point of the atlas: zero per-thumbnail requests.
  const withAtlas = buildPrefetchPlan(vp, STILL, cfg, concepts)
  check('atlas: concepts with a slot generate no thumbnail requests',
    withAtlas.length === 0, `${withAtlas.length} planned`)

  // Fallback path: a concept uploaded since the last atlas build still loads.
  const fallback = buildPrefetchPlan(vp, STILL, cfg, noSlot)
  const visible = visibleConceptIndices(vp, cfg, N)
  const tier0 = new Set(fallback.filter(e => e.tier === TIER.VISIBLE).map(e => e.url))
  const missing = [...visible].filter(ci => !tier0.has(getThumbUrl(noSlot[ci])))
  check('fallback: every on-screen slotless card is in tier 0', missing.length === 0, `${missing.length} missing`)
  check('fallback: plan is non-empty', fallback.length > 0)

  // A partially-rebuilt archive must only fetch the concepts that need it.
  const mixed = concepts.map((c, i) => ({ ...c, atlas_slot: i % 2 === 0 ? i : null }))
  const mixedPlan = buildPrefetchPlan(vp, STILL, cfg, mixed)
  const slotted = new Set(mixed.filter(c => c.atlas_slot !== null).map(getThumbUrl))
  check('atlas: mixed archive fetches only the slotless concepts',
    mixedPlan.length > 0 && !mixedPlan.some(e => slotted.has(e.url)))
}

// ---------------------------------------------------------------- overscan
{
  const vp = vpAt(1680, 1210, DEFAULT_ZOOM)
  const withOverscan = buildPrefetchPlan(vp, STILL, cfg, noSlot, 'nearby')
  const minimal = buildPrefetchPlan(vp, STILL, cfg, noSlot, 'minimal')
  check('overscan: nearby plans more than minimal', withOverscan.length > minimal.length)
  check('overscan: minimal stops at the predicted tier',
    minimal.every(e => e.tier <= TIER.PREDICTED))
  // The background tier was deleted with the atlas: it existed to pull all 964
  // thumbnails ahead of time, which is now a single atlas request. Assert it
  // stays gone, so nobody reintroduces 964 speculative fetches.
  const small = vpAt(500, 400, 0.6)
  const fullSmall = buildPrefetchPlan(small, STILL, cfg, noSlot, 'full')
  check('background: no speculative whole-archive tier remains',
    !fullSmall.some(e => e.tier === TIER.BACKGROUND))
  check('background: plans stay bounded by what is near the viewport',
    fullSmall.length < N, `${fullSmall.length} planned of ${N}`)
  // The ring must actually contain cards outside the current viewport.
  const visible = visibleConceptIndices(vp, cfg, N)
  const visibleUrls = new Set([...visible].map(ci => getThumbUrl(noSlot[ci])))
  const beyond = withOverscan.filter(e => e.tier === TIER.OVERSCAN && !visibleUrls.has(e.url))
  check('overscan: contains cards not currently visible', beyond.length > 0, `${beyond.length}`)
}

// -------------------------------------------------------------- prediction
{
  const vp = vpAt(1680, 1210, DEFAULT_ZOOM)
  const stillPlan = buildPrefetchPlan(vp, STILL, cfg, noSlot, 'nearby')
  const stillPredicted = stillPlan.filter(e => e.tier === TIER.PREDICTED).length
  check('prediction: a still camera predicts nothing', stillPredicted === 0)

  // Panning right should promote cards to the right into the predicted tier.
  const moving: Motion = { vx: 4000, vy: 0, targetZoom: DEFAULT_ZOOM, isMoving: true }
  const movingPlan = buildPrefetchPlan(vp, moving, cfg, noSlot, 'nearby')
  const predicted = movingPlan.filter(e => e.tier === TIER.PREDICTED)
  check('prediction: panning creates a predicted tier', predicted.length > 0, `${predicted.length}`)

  // Those predicted cards must be ones the current viewport does not show.
  const visibleUrls = new Set(
    [...visibleConceptIndices(vp, cfg, N)].map(ci => getThumbUrl(noSlot[ci]))
  )
  check('prediction: aims outside the current viewport',
    predicted.some(e => !visibleUrls.has(e.url)))

  // Zooming out must plan the wider set before the animation lands.
  const zoomOut: Motion = { vx: 0, vy: 0, targetZoom: MIN_ZOOM, isMoving: true }
  const zoomPlan = buildPrefetchPlan(vp, zoomOut, cfg, noSlot, 'nearby')
  const zoomTarget = vpAt(1680, 1210, MIN_ZOOM)
  const targetVisible = visibleConceptIndices(zoomTarget, cfg, N)
  const planned = new Set(zoomPlan.filter(e => e.tier <= TIER.PREDICTED).map(e => e.url))
  const covered = [...targetVisible].filter(ci => planned.has(getThumbUrl(noSlot[ci]))).length
  check('prediction: zoom-out target is planned before it lands',
    covered / targetVisible.size >= 0.95, `${((covered / targetVisible.size) * 100).toFixed(0)}% covered`)
}

// ------------------------------------------------------- promotion/demotion
{
  const a = vpAt(1680, 1210, DEFAULT_ZOOM)
  const far = vpAt(1680, 1210, DEFAULT_ZOOM, cfg.tileWidth / 2 + 40000, cfg.tileHeight / 2)
  const planA = buildPrefetchPlan(a, STILL, cfg, noSlot, 'nearby')
  const planB = buildPrefetchPlan(far, STILL, cfg, noSlot, 'nearby')
  const aVisible = new Set(planA.filter(e => e.tier === TIER.VISIBLE).map(e => e.url))
  const bVisible = new Set(planB.filter(e => e.tier === TIER.VISIBLE).map(e => e.url))
  check('demotion: a distant viewport yields a different visible set',
    [...bVisible].some(u => !aVisible.has(u)))
  // Anything visible at B must outrank everything that was merely overscan at A.
  const worstBVisible = Math.max(...planB.filter(e => e.tier === TIER.VISIBLE).map(e => e.priority))
  const bestAOverscan = Math.min(...planA.filter(e => e.tier === TIER.OVERSCAN).map(e => e.priority))
  check('promotion: newly visible outranks stale overscan', worstBVisible < bestAOverscan)
}

// ------------------------------------------------------------------ dedupe
{
  const vp = vpAt(2560, 1440, MIN_ZOOM)
  const plan = buildPrefetchPlan(vp, STILL, cfg, noSlot)
  const seen = new Set<string>()
  let dupes = 0
  for (const e of plan) { if (seen.has(e.url)) dupes++; seen.add(e.url) }
  check('dedupe: no URL appears twice in a plan', dupes === 0, `${dupes} duplicates`)
  check('dedupe: plan never exceeds the unique asset count',
    seen.size <= N * 2, `${seen.size} urls`)

  // The grid tiles the same concepts, so a huge viewport must not multiply work.
  const huge = buildPrefetchPlan(vpAt(6016, 3384, MIN_ZOOM), STILL, cfg, noSlot)
  const hugeUnique = new Set(huge.map(e => e.url))
  check('dedupe: tiling does not inflate the request set', hugeUnique.size <= N * 2,
    `${hugeUnique.size}`)
}

// ------------------------------------------------------------------ mid-res
{
  const zoomedOut = buildPrefetchPlan(vpAt(1680, 1210, DEFAULT_ZOOM), STILL, cfg, noSlot)
  const midUrls = new Set(concepts.map(getMidUrl))
  check('lod: no mid-res requested when zoomed out',
    !zoomedOut.some(e => midUrls.has(e.url)))
  const zoomedIn = buildPrefetchPlan(vpAt(1680, 1210, 0.8), STILL, cfg, noSlot)
  check('lod: mid-res requested when zoomed in',
    zoomedIn.some(e => midUrls.has(e.url)))
  check('lod: mid-res never enters the background tier',
    !zoomedIn.some(e => midUrls.has(e.url) && e.tier >= TIER.OVERSCAN))
  // Atlas covers thumbnails, but zooming in must still fetch mid-res.
  const atlasZoomedIn = buildPrefetchPlan(vpAt(1680, 1210, 0.8), STILL, cfg, concepts)
  check('lod: atlas-backed concepts still fetch mid-res when zoomed in',
    atlasZoomedIn.length > 0 && atlasZoomedIn.every(e => midUrls.has(e.url)))
}

// ------------------------------------------------------- wide screens / edge
{
  for (const [w, h] of [[3440, 1440], [3840, 2160], [6016, 3384]] as const) {
    const vp = vpAt(w, h, MIN_ZOOM)
    const plan = buildPrefetchPlan(vp, STILL, cfg, noSlot)
    const tier0 = new Set(plan.filter(e => e.tier === TIER.VISIBLE).map(e => e.url))
    const visible = visibleConceptIndices(vp, cfg, N)
    const missing = [...visible].filter(ci => !tier0.has(getThumbUrl(noSlot[ci])))
    check(`wide: ${w}x${h} plans every visible card`, missing.length === 0, `${missing.length} missing`)
  }
}

// --------------------------------------------------------------- degenerate
{
  const empty = computeGridConfig(0)
  const plan = buildPrefetchPlan(vpAt(1920, 1080, DEFAULT_ZOOM, 0, 0), STILL, empty, [])
  check('degenerate: empty archive plans nothing', plan.length === 0)
  const zeroZoom = buildPrefetchPlan({ pan: { x: 0, y: 0 }, zoom: 0, width: 1920, height: 1080 }, STILL, cfg, concepts)
  check('degenerate: zero zoom plans nothing', zeroZoom.length === 0)
  const zeroSize = buildPrefetchPlan({ pan: { x: 0, y: 0 }, zoom: 0.3, width: 0, height: 0 }, STILL, cfg, concepts)
  check('degenerate: zero-size viewport plans nothing', zeroSize.length === 0)
}

// ------------------------------------------------------- ordering guarantee
{
  const vp = vpAt(1680, 1210, DEFAULT_ZOOM)
  const moving: Motion = { vx: 3000, vy: 0, targetZoom: DEFAULT_ZOOM, isMoving: true }
  const plan = buildPrefetchPlan(vp, moving, cfg, noSlot).sort((a, b) => a.priority - b.priority)
  let lastTier = -1
  let monotonic = true
  for (const e of plan) {
    if (e.tier < lastTier) monotonic = false
    lastTier = Math.max(lastTier, e.tier)
  }
  check('ordering: sorting by priority yields tier order', monotonic)
  check('ordering: the very first entry is visible-tier', plan[0]?.tier === TIER.VISIBLE)
}

console.log(`\n  ${passed} passed, ${failures.length} failed\n`)
for (const f of failures) console.log(`    FAIL  ${f}`)
if (failures.length) process.exit(1)
console.log('  PASS - prefetch pipeline behaves as specified\n')
