'use client'

import { Texture, ImageSource, Rectangle } from 'pixi.js'

/**
 * Thumbnail atlases.
 *
 * The canvas used to fetch one ~3 KB image per concept: 964 requests, ~2.9 MB,
 * at a measured ~295 ms request latency against ~1 ms of decode. The cost was
 * almost entirely request topology, so the thumbnails are now packed into two
 * images and every card takes a sub-rectangle of an already-decoded texture.
 *
 *   preview  1024x992   ~173 KB   32px cells   first paint
 *   thumbs   4096x3968  ~1.47 MB  128px cells  full quality
 *
 * Layout is arithmetic, so there is no coordinate manifest to fetch: slot N is
 * at (N % COLS * CELL, floor(N / COLS) * CELL). Each concept carries its slot
 * in `atlas_slot`, which already rides along in the page payload.
 *
 * Served from public/ rather than object storage on purpose - a cold request to
 * Supabase Storage measured ~1000 ms of TTFB even for the 173 KB preview,
 * because it is a separate origin needing its own DNS + TCP + TLS. Same-origin
 * reuses the connection the page already has open.
 */
export const ATLAS = {
  cell: 128,
  cols: 32,
  slotsPerAtlas: 1024,
  count: 1,
  url: (i: number) => `/atlas/thumbs-${i}-v1.webp`,
} as const

export const PREVIEW = {
  cell: 32,
  cols: 32,
  url: '/atlas/preview-v1.webp',
} as const

export type AtlasLevel = 'preview' | 'full'

interface LoadedAtlas {
  base: Texture
  frames: Map<number, Texture>
  cell: number
  cols: number
}

export interface AtlasStore {
  /** Best available texture for a slot, or null if no atlas has arrived yet. */
  get: (slot: number | null | undefined) => Texture | null
  /** Which level a slot currently resolves to, for upgrade decisions. */
  levelOf: (slot: number | null | undefined) => AtlasLevel | null
  load: (onReady: (level: AtlasLevel) => void) => void
  destroy: () => void
  stats: () => {
    previewReady: boolean
    fullReady: boolean
    framesCreated: number
    bytes: number
    timings: Record<string, number>
  }
}

function frameFor(atlas: LoadedAtlas, slotInAtlas: number): Texture {
  const cached = atlas.frames.get(slotInAtlas)
  if (cached) return cached
  const x = (slotInAtlas % atlas.cols) * atlas.cell
  const y = Math.floor(slotInAtlas / atlas.cols) * atlas.cell
  const tex = new Texture({
    source: atlas.base.source,
    frame: new Rectangle(x, y, atlas.cell, atlas.cell),
  })
  atlas.frames.set(slotInAtlas, tex)
  return tex
}

export function createAtlasStore(): AtlasStore {
  let preview: LoadedAtlas | null = null
  const full = new Map<number, LoadedAtlas>()
  let destroyed = false
  const timings: Record<string, number> = {}

  const loadOne = async (
    url: string,
    cell: number,
    cols: number,
    label: string
  ): Promise<LoadedAtlas | null> => {
    const t0 = performance.now()
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      timings[`${label}NetworkMs`] = Math.round(performance.now() - t0)
      const t1 = performance.now()
      const bitmap = await createImageBitmap(blob)
      timings[`${label}DecodeMs`] = Math.round(performance.now() - t1)
      if (destroyed) {
        bitmap.close()
        return null
      }
      const base = new Texture({ source: new ImageSource({ resource: bitmap }) })
      timings[`${label}TotalMs`] = Math.round(performance.now() - t0)
      timings[`${label}Bytes`] = blob.size
      return { base, frames: new Map(), cell, cols }
    } catch {
      timings[`${label}Failed`] = 1
      return null
    }
  }

  const load = (onReady: (level: AtlasLevel) => void) => {
    // Preview first: it is ~8x smaller and decodes in ~46 ms against ~500 ms for
    // the full atlas, so the canvas is completely populated far sooner. The full
    // atlas then swaps in underneath without any visible reload.
    loadOne(PREVIEW.url, PREVIEW.cell, PREVIEW.cols, 'preview').then((a) => {
      if (!a || destroyed) return
      preview = a
      onReady('preview')
    })
    for (let i = 0; i < ATLAS.count; i++) {
      loadOne(ATLAS.url(i), ATLAS.cell, ATLAS.cols, i === 0 ? 'full' : `full${i}`).then((a) => {
        if (!a || destroyed) return
        full.set(i, a)
        onReady('full')
      })
    }
  }

  const get = (slot: number | null | undefined): Texture | null => {
    if (slot === null || slot === undefined || slot < 0) return null
    const atlasIndex = Math.floor(slot / ATLAS.slotsPerAtlas)
    const inAtlas = slot % ATLAS.slotsPerAtlas
    const f = full.get(atlasIndex)
    if (f) return frameFor(f, inAtlas)
    if (preview) return frameFor(preview, slot)
    return null
  }

  const levelOf = (slot: number | null | undefined): AtlasLevel | null => {
    if (slot === null || slot === undefined || slot < 0) return null
    if (full.has(Math.floor(slot / ATLAS.slotsPerAtlas))) return 'full'
    if (preview) return 'preview'
    return null
  }

  const destroy = () => {
    destroyed = true
    for (const a of [preview, ...full.values()]) {
      if (!a) continue
      for (const t of a.frames.values()) t.destroy(false) // frames share the base source
      a.frames.clear()
      a.base.destroy(true)
    }
    preview = null
    full.clear()
  }

  const stats = () => {
    let framesCreated = preview ? preview.frames.size : 0
    for (const a of full.values()) framesCreated += a.frames.size
    let bytes = 0
    if (preview) bytes += preview.base.source.width * preview.base.source.height * 4
    for (const a of full.values()) bytes += a.base.source.width * a.base.source.height * 4
    return {
      previewReady: preview !== null,
      fullReady: full.size === ATLAS.count,
      framesCreated,
      bytes,
      timings,
    }
  }

  return { get, levelOf, load, destroy, stats }
}
