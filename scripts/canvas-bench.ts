/**
 * Deterministic loading benchmark.
 *
 * Simulates the loader against scripted camera movement so coverage can be
 * measured repeatably, instead of eyeballing screenshots. The network model is
 * fed by numbers measured against the production origin from a real browser:
 *
 *   cold request        ~220 ms   (single request, round trip to the origin)
 *   HTTP-cache hit      ~0.5 ms   (measured 57x faster than cold)
 *   decode              ~0.88 ms  (createImageBitmap on a 150x150 JPEG)
 *
 * The metric is the one that matters to a user: of the tiles on screen in the
 * first frame after a pan/zoom/resize, what share already had a texture.
 *
 * Run: npx tsx scripts/canvas-bench.ts
 */
import {
  computeGridConfig,
  getThumbUrl,
  MIN_ZOOM,
  DEFAULT_ZOOM,
  type Viewport,
} from '../src/components/canvas/canvas-utils'
import { buildPrefetchPlan, visibleConceptIndices, STILL, type Motion } from '../src/components/canvas/prefetch'
import type { CanvasConcept } from '../src/lib/types'

const COLD_MS = 220
const WARM_MS = 0.5
const DECODE_MS = 0.88
const FRAME_MS = 16.67

const CONCEPT_COUNT = 964
const concepts: CanvasConcept[] = Array.from({ length: CONCEPT_COUNT }, (_, i) => ({
  id: `id-${i}`, slug: `s-${i}`, title: `T${i}`, caption: null,
  image_url: `o-${i}.png`, thumbnail_url: `thumbnails/t-${i}.jpg`, mid_url: `mid/m-${i}.jpg`, atlas_slot: i,
  category: null, date_posted: '2025-01-01',
}))
const cfg = computeGridConfig(CONCEPT_COUNT)

type Policy = 'reactive' | 'predictive'

class Sim {
  now = 0
  textures = new Set<string>()
  httpWarm = new Set<string>()
  inFlight = new Map<string, { done: number; warm: boolean }>()
  queue = new Map<string, number>()
  warmOnly = new Set<string>()
  requests = 0

  constructor(readonly policy: Policy, readonly concurrency: number) {}

  /** Reactive = the old behaviour: only ask for what is already on screen. */
  plan(vp: Viewport, motion: Motion) {
    this.queue = new Map()
    this.warmOnly = new Set()
    if (this.policy === 'reactive') {
      const visible = visibleConceptIndices(vp, cfg, concepts.length)
      let i = 0
      for (const ci of visible) {
        const url = getThumbUrl(concepts[ci])
        if (!this.textures.has(url)) this.queue.set(url, i++)
      }
      return
    }
    for (const e of buildPrefetchPlan(vp, motion, cfg, concepts)) {
      if (this.textures.has(e.url)) continue
      const prev = this.queue.get(e.url)
      if (prev === undefined || e.priority < prev) this.queue.set(e.url, e.priority)
    }
  }

  step() {
    for (const [url, f] of this.inFlight) {
      if (f.done <= this.now) {
        this.inFlight.delete(url)
        if (f.warm) this.httpWarm.add(url)
        else this.textures.add(url)
      }
    }
    const free = this.concurrency - this.inFlight.size
    if (free > 0 && this.queue.size > 0) {
      const sorted = [...this.queue.entries()].sort((a, b) => a[1] - b[1])
      let started = 0
      for (const [url] of sorted) {
        if (started >= free) break
        this.queue.delete(url)
        if (this.textures.has(url) || this.inFlight.has(url)) continue
        const net = this.httpWarm.has(url) ? WARM_MS : COLD_MS
        this.httpWarm.add(url) // bytes stay in the browser HTTP cache afterwards
        this.inFlight.set(url, { done: this.now + net + DECODE_MS, warm: false })
        this.requests++
        started++
      }
    }
    this.now += FRAME_MS
  }

  coverage(vp: Viewport): { pct: number; total: number; ready: number } {
    const visible = visibleConceptIndices(vp, cfg, concepts.length)
    let ready = 0
    for (const ci of visible) if (this.textures.has(getThumbUrl(concepts[ci]))) ready++
    return { pct: visible.size ? (ready / visible.size) * 100 : 100, total: visible.size, ready }
  }

  /** Advance to a new camera position and report first-frame coverage. */
  moveTo(vp: Viewport, motion: Motion): number {
    this.plan(vp, motion)
    const first = this.coverage(vp).pct
    return first
  }

  /**
   * Advance until the visible set is covered, and then keep going for `idleMs`
   * so background prefetch can run. A real user looks at the canvas before
   * panning; a model that stops the instant the visible set is covered would
   * never give the overscan and background tiers a chance, which is exactly
   * the work that makes the *next* interaction instant.
   */
  settle(vp: Viewport, motion: Motion, idleMs = 12000, maxMs = 90000) {
    const marks = { t98: -1, t100: -1 }
    const start = this.now
    let covered = -1
    while (this.now - start < maxMs) {
      this.step()
      this.plan(vp, motion)
      const c = this.coverage(vp).pct
      if (marks.t98 < 0 && c >= 98) marks.t98 = this.now - start
      if (marks.t100 < 0 && c >= 100) { marks.t100 = this.now - start; covered = this.now }
      if (covered > 0 && this.now - covered >= idleMs) break
      if (covered > 0 && this.queue.size === 0 && this.inFlight.size === 0) break
    }
    return marks
  }
}

function vpAt(w: number, h: number, zoom: number, x: number, y: number): Viewport {
  return { pan: { x, y }, zoom, width: w, height: h }
}

const SCREENS: Array<[string, number, number]> = [
  ['small 987x950', 987, 950],
  ['laptop 1470x956', 1470, 956],
  ['1680x1210', 1680, 1210],
  ['1920x1080', 1920, 1080],
  ['1440p 2560x1440', 2560, 1440],
]

function pct(n: number) { return n.toFixed(1).padStart(6) }

console.log('\n=== COLD LOAD: time to coverage from an empty cache ===')
console.log('  screen                policy       first-frame   to 98%     to 100%   requests')
for (const [label, w, h] of SCREENS) {
  for (const policy of ['reactive', 'predictive'] as Policy[]) {
    const sim = new Sim(policy, 24)
    const vp = vpAt(w, h, DEFAULT_ZOOM, cfg.tileWidth / 2, cfg.tileHeight / 2)
    const first = sim.moveTo(vp, STILL)
    const m = sim.settle(vp, STILL)
    console.log(
      `  ${label.padEnd(20)} ${policy.padEnd(12)} ${pct(first)}%   ${String(m.t98 < 0 ? 'never' : Math.round(m.t98) + 'ms').padStart(7)}   ${String(m.t100 < 0 ? 'never' : Math.round(m.t100) + 'ms').padStart(7)}   ${String(sim.requests).padStart(6)}`
    )
  }
}

console.log('\n=== PAN: settle, then pan exactly one viewport, 4 directions ===')
console.log('  screen                policy       first-frame coverage after each pan        mean')
for (const [label, w, h] of SCREENS) {
  for (const policy of ['reactive', 'predictive'] as Policy[]) {
    const sim = new Sim(policy, 24)
    let x = cfg.tileWidth / 2
    let y = cfg.tileHeight / 2
    const vp0 = vpAt(w, h, DEFAULT_ZOOM, x, y)
    sim.moveTo(vp0, STILL)
    sim.settle(vp0, STILL)
    const results: number[] = []
    const dirs: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]]
    for (const [dx, dy] of dirs) {
      const stepX = (w / DEFAULT_ZOOM) * dx
      const stepY = (h / DEFAULT_ZOOM) * dy
      // Motion is known while the drag is happening: feed it, and let the
      // prefetcher work during the ~250ms the gesture takes.
      const moving: Motion = { vx: stepX / 15, vy: stepY / 15, targetZoom: DEFAULT_ZOOM, isMoving: true }
      const mid = vpAt(w, h, DEFAULT_ZOOM, x + stepX / 2, y + stepY / 2)
      sim.plan(mid, moving)
      for (let i = 0; i < 15; i++) { sim.step(); sim.plan(mid, moving) }
      x += stepX; y += stepY
      const vp = vpAt(w, h, DEFAULT_ZOOM, x, y)
      results.push(sim.moveTo(vp, STILL))
      sim.settle(vp, STILL)
    }
    const mean = results.reduce((a, b) => a + b, 0) / results.length
    console.log(`  ${label.padEnd(20)} ${policy.padEnd(12)} ${results.map(pct).join('% ')}%   ${pct(mean)}%`)
  }
}

console.log('\n=== ZOOM: out to min, in to 0.5, out again, from a settled view ===')
console.log('  screen                policy       zoom-out   zoom-in   zoom-out   mean')
for (const [label, w, h] of SCREENS) {
  for (const policy of ['reactive', 'predictive'] as Policy[]) {
    const sim = new Sim(policy, 24)
    const x = cfg.tileWidth / 2
    const y = cfg.tileHeight / 2
    const start = vpAt(w, h, DEFAULT_ZOOM, x, y)
    sim.moveTo(start, STILL); sim.settle(start, STILL)
    const results: number[] = []
    for (const target of [MIN_ZOOM, 0.5, MIN_ZOOM]) {
      const moving: Motion = { vx: 0, vy: 0, targetZoom: target, isMoving: true }
      const current = vpAt(w, h, DEFAULT_ZOOM, x, y)
      sim.plan(current, moving)
      for (let i = 0; i < 12; i++) { sim.step(); sim.plan(current, moving) }
      const vp = vpAt(w, h, target, x, y)
      results.push(sim.moveTo(vp, STILL))
      sim.settle(vp, STILL)
    }
    const mean = results.reduce((a, b) => a + b, 0) / results.length
    console.log(`  ${label.padEnd(20)} ${policy.padEnd(12)} ${results.map(pct).join('%  ')}%  ${pct(mean)}%`)
  }
}

console.log('\n=== ABUSE: 20s of rapid random pan + zoom, no settling ===')
console.log('  screen                policy       worst frame   mean    frames <98%   recovery to 100%')
for (const [label, w, h] of SCREENS) {
  for (const policy of ['reactive', 'predictive'] as Policy[]) {
    const sim = new Sim(policy, 24)
    let x = cfg.tileWidth / 2, y = cfg.tileHeight / 2, zoom = DEFAULT_ZOOM
    const first = vpAt(w, h, zoom, x, y)
    sim.moveTo(first, STILL); sim.settle(first, STILL)
    let worst = 100, sum = 0, n = 0, below = 0
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let f = 0; f < 1200; f++) { // 20s at 60fps
      const dx = (rnd() - 0.5) * (w / zoom) * 0.35
      const dy = (rnd() - 0.5) * (h / zoom) * 0.35
      x += dx; y += dy
      if (f % 45 === 0) zoom = Math.max(MIN_ZOOM, Math.min(0.6, zoom + (rnd() - 0.5) * 0.25))
      const motion: Motion = { vx: dx, vy: dy, targetZoom: zoom, isMoving: true }
      const vp = vpAt(w, h, zoom, x, y)
      sim.plan(vp, motion)
      sim.step()
      const c = sim.coverage(vp).pct
      worst = Math.min(worst, c); sum += c; n++
      if (c < 98) below++
    }
    const restVp = vpAt(w, h, zoom, x, y)
    const rec = sim.settle(restVp, STILL)
    console.log(
      `  ${label.padEnd(20)} ${policy.padEnd(12)} ${pct(worst)}%   ${pct(sum / n)}%   ${String(((below / n) * 100).toFixed(0) + '%').padStart(9)}   ${String(rec.t100 < 0 ? '>60s' : Math.round(rec.t100) + 'ms').padStart(10)}`
    )
  }
}

console.log('\n=== RETURN NAVIGATION: pan far away, then come back ===')
console.log('  screen                policy       coverage on return')
for (const [label, w, h] of SCREENS) {
  for (const policy of ['reactive', 'predictive'] as Policy[]) {
    const sim = new Sim(policy, 24)
    const home = vpAt(w, h, DEFAULT_ZOOM, cfg.tileWidth / 2, cfg.tileHeight / 2)
    sim.moveTo(home, STILL); sim.settle(home, STILL)
    const away = vpAt(w, h, DEFAULT_ZOOM, cfg.tileWidth / 2 + (w / DEFAULT_ZOOM) * 6, cfg.tileHeight / 2 + (h / DEFAULT_ZOOM) * 4)
    sim.moveTo(away, STILL); sim.settle(away, STILL)
    const back = sim.moveTo(home, STILL)
    console.log(`  ${label.padEnd(20)} ${policy.padEnd(12)} ${pct(back)}%`)
  }
}

console.log('\n=== MEMORY: decoded texture bytes held by the predictive policy ===')
{
  const sim = new Sim('predictive', 24)
  const vp = vpAt(2560, 1440, MIN_ZOOM, cfg.tileWidth / 2, cfg.tileHeight / 2)
  sim.moveTo(vp, STILL); sim.settle(vp, STILL)
  const thumbBytes = 150 * 150 * 4
  console.log(`  textures decoded      ${sim.textures.size}`)
  console.log(`  GPU bytes             ${(sim.textures.size * thumbBytes / 1048576).toFixed(1)} MB`)
  console.log(`  HTTP-cached bytes     ${sim.httpWarm.size} objects, ~${(sim.httpWarm.size * 3100 / 1048576).toFixed(1)} MB`)
  console.log(`  total network         ${sim.requests} requests`)
}
console.log()
