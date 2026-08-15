/**
 * Pack every thumbnail into a small number of texture atlases.
 *
 * Why this exists: the canvas was fetching one ~3 KB resource per concept.
 * With request p50 ~295 ms and decode ~1 ms, essentially the entire cost of
 * showing the archive was per-request latency for 964 tiny files that add up
 * to about 3 MB. Packing them means the initial canvas needs a couple of
 * requests instead of several hundred.
 *
 * Layout is pure arithmetic - slot N lives at
 * (N % cols * CELL, floor(N / cols) * CELL) - so the manifest is a handful of
 * numbers rather than 964 coordinate entries. Each concept stores its slot in
 * `atlas_slot`, which survives re-ordering and new uploads.
 *
 * Usage: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/build-atlas.ts [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const DRY = process.argv.includes('--dry')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

/**
 * 4096 is the universally safe max texture dimension (iOS Safari guarantees it;
 * this machine reports 16384). 128px cells give 32 columns.
 *
 * 128 is enough: thumbnails only render up to zoom 0.5, where a card is 120 CSS
 * px, and past that the canvas switches to mid-res anyway.
 */
const ATLAS_MAX = 4096
const CELL = 128
const COLS = Math.floor(ATLAS_MAX / CELL) // 32
const SLOTS_PER_ATLAS = COLS * COLS // 1024

/** A much smaller atlas for the very first paint. */
const PREVIEW_CELL = 32
const PREVIEW_COLS = COLS

interface Row { id: string; slug: string; thumbnail_url: string | null; date_posted: string | null }

async function fetchAll(): Promise<Row[]> {
  // Same ordering the canvas uses, so neighbouring slots are neighbouring cards
  // and a viewport touches as few atlases as possible.
  const { data, error } = await supabase
    .from('concepts')
    .select('id, slug, thumbnail_url, date_posted')
    .eq('is_published', true)
    .order('date_posted', { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as Row[]
}

async function download(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
    }
  }
  return null
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    })
  )
  return out
}

async function buildAtlas(
  tiles: Array<{ slot: number; buf: Buffer }>,
  cell: number,
  cols: number,
  quality: number
): Promise<{ webp: Buffer; width: number; height: number }> {
  const rows = Math.ceil(tiles.length ? (Math.max(...tiles.map((t) => t.slot)) + 1) / cols : 1)
  const width = cols * cell
  const height = rows * cell

  const composites = await mapLimit(tiles, 8, async ({ slot, buf }) => ({
    input: await sharp(buf).resize(cell, cell, { fit: 'cover', position: 'centre' }).toBuffer(),
    left: (slot % cols) * cell,
    top: Math.floor(slot / cols) * cell,
  }))

  const webp = await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 10, b: 10 } },
  })
    .composite(composites)
    .webp({ quality, effort: 6 })
    .toBuffer()

  return { webp, width, height }
}

async function main() {
  console.log('Fetching concepts...')
  const rows = await fetchAll()
  console.log(`  ${rows.length} published concepts`)

  console.log('Downloading thumbnails...')
  let failures = 0
  const buffers = await mapLimit(rows, 24, async (r) => {
    if (!r.thumbnail_url) { failures++; return null }
    const b = await download(r.thumbnail_url)
    if (!b) failures++
    return b
  })
  console.log(`  downloaded ${buffers.filter(Boolean).length}, failed ${failures}`)

  const totalSourceBytes = buffers.reduce((a, b) => a + (b?.length ?? 0), 0)
  console.log(`  source bytes: ${(totalSourceBytes / 1048576).toFixed(2)} MB across ${rows.length} requests`)

  // Slot assignment follows canvas order; atlas index is slot / SLOTS_PER_ATLAS.
  const atlasCount = Math.ceil(rows.length / SLOTS_PER_ATLAS)
  console.log(`\nPacking into ${atlasCount} atlas/atlases (${CELL}px cells, ${COLS} cols)...`)

  const results: Array<{ name: string; bytes: number; w: number; h: number }> = []
  const uploads: Array<{ path: string; body: Buffer; contentType: string }> = []

  for (let a = 0; a < atlasCount; a++) {
    const tiles: Array<{ slot: number; buf: Buffer }> = []
    for (let i = 0; i < rows.length; i++) {
      if (Math.floor(i / SLOTS_PER_ATLAS) !== a) continue
      const buf = buffers[i]
      if (buf) tiles.push({ slot: i % SLOTS_PER_ATLAS, buf })
    }
    // Quality sweep, so the choice is measured rather than guessed.
    for (const q of [70, 78, 86]) {
      const { webp, width, height } = await buildAtlas(tiles, CELL, COLS, q)
      console.log(`  atlas ${a} q${q}: ${(webp.length / 1024).toFixed(0)} KB  ${width}x${height}  (GPU ${(width * height * 4 / 1048576).toFixed(0)} MB)`)
      if (q === 78) {
        results.push({ name: `atlas-${a}`, bytes: webp.length, w: width, h: height })
        uploads.push({ path: `atlas/thumbs-${a}-v1.webp`, body: webp, contentType: 'image/webp' })
      }
    }
  }

  // Preview atlas: whole archive at 32px, for a near-instant first paint.
  const previewTiles: Array<{ slot: number; buf: Buffer }> = []
  for (let i = 0; i < rows.length; i++) if (buffers[i]) previewTiles.push({ slot: i, buf: buffers[i]! })
  for (const q of [55, 65, 75]) {
    const { webp, width, height } = await buildAtlas(previewTiles, PREVIEW_CELL, PREVIEW_COLS, q)
    console.log(`  preview q${q}: ${(webp.length / 1024).toFixed(0)} KB  ${width}x${height}  (GPU ${(width * height * 4 / 1048576).toFixed(1)} MB)`)
    if (q === 65) {
      results.push({ name: 'preview', bytes: webp.length, w: width, h: height })
      uploads.push({ path: 'atlas/preview-v1.webp', body: webp, contentType: 'image/webp' })
    }
  }

  const totalAtlas = results.filter((r) => r.name !== 'preview').reduce((a, r) => a + r.bytes, 0)
  const preview = results.find((r) => r.name === 'preview')!
  console.log(`\n  BEFORE: ${rows.length} requests, ${(totalSourceBytes / 1048576).toFixed(2)} MB`)
  console.log(`  AFTER : ${atlasCount + 1} requests, ${((totalAtlas + preview.bytes) / 1048576).toFixed(2)} MB`)
  console.log(`  request reduction: ${(rows.length / (atlasCount + 1)).toFixed(0)}x`)

  if (DRY) { console.log('\n  --dry: nothing uploaded or written\n'); return }

  // Written into public/ rather than object storage. Measured: a cold request
  // to Supabase Storage costs ~1000 ms of TTFB even for a 173 KB file, because
  // it is a different origin and needs its own DNS + TCP + TLS. Serving from
  // the same origin as the page reuses the already-open edge connection.
  const publicDir = path.resolve(process.cwd(), 'public', 'atlas')
  fs.mkdirSync(publicDir, { recursive: true })
  for (const u of uploads) {
    const file = path.join(publicDir, path.basename(u.path))
    fs.writeFileSync(file, u.body)
    console.log(`  wrote ${path.relative(process.cwd(), file)} (${(u.body.length / 1024).toFixed(0)} KB)`)
  }

  console.log('\nUploading atlases (storage copy, for tooling)...')
  for (const u of uploads) {
    const { error } = await supabase.storage.from('concepts').upload(u.path, u.body, {
      contentType: u.contentType,
      cacheControl: '31536000, immutable',
      upsert: true,
    })
    if (error) throw error
    console.log(`  uploaded ${u.path} (${(u.body.length / 1024).toFixed(0)} KB)`)
  }

  console.log('Writing atlas_slot...')
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    await Promise.all(
      slice.map((r, j) =>
        supabase.from('concepts').update({ atlas_slot: i + j }).eq('id', r.id)
      )
    )
    process.stdout.write(`\r  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`)
  }
  console.log('\n  done')

  console.log(`\nManifest values for src/components/canvas/atlas.ts:`)
  console.log(`  CELL=${CELL} COLS=${COLS} SLOTS_PER_ATLAS=${SLOTS_PER_ATLAS} ATLAS_COUNT=${atlasCount}`)
  console.log(`  PREVIEW_CELL=${PREVIEW_CELL} PREVIEW_COLS=${PREVIEW_COLS}\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
