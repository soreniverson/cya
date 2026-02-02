/**
 * Batch generate JPEG thumbnails for all concepts
 *
 * Usage:
 *   npx tsx scripts/generate-thumbnails.ts
 *
 * Requirements:
 *   - SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   - Add 'thumbnail_url' column to concepts table (script will prompt if missing)
 */

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load env
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY in .env.local')
  console.error('   Get it from: Supabase Dashboard → Settings → API → Service Role Key')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

// Thumbnail settings
const THUMB_WIDTH = 150
const THUMB_QUALITY = 75
const BUCKET = 'concepts'
const THUMB_FOLDER = 'thumbnails'

interface Concept {
  id: string
  slug: string
  image_url: string
  thumbnail_url: string | null
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function createThumbnail(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize(THUMB_WIDTH, THUMB_WIDTH, {
      fit: 'cover',
      position: 'center'
    })
    .jpeg({
      quality: THUMB_QUALITY,
      mozjpeg: true // Better compression
    })
    .toBuffer()
}

async function uploadThumbnail(buffer: Buffer, filename: string): Promise<string> {
  const thumbPath = `${THUMB_FOLDER}/${filename}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(thumbPath, buffer, {
      contentType: 'image/jpeg',
      upsert: true
    })

  if (error) {
    throw new Error(`Upload failed: ${error.message}`)
  }

  // Get public URL
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(thumbPath)
  return data.publicUrl
}

async function updateConceptThumbnail(id: string, thumbnailUrl: string): Promise<void> {
  const { error } = await supabase
    .from('concepts')
    .update({ thumbnail_url: thumbnailUrl })
    .eq('id', id)

  if (error) {
    throw new Error(`DB update failed: ${error.message}`)
  }
}

async function processConceptBatch(concepts: Concept[], batchNum: number, totalBatches: number): Promise<{ success: number, failed: number }> {
  let success = 0
  let failed = 0

  for (const concept of concepts) {
    try {
      // Skip if already has thumbnail
      if (concept.thumbnail_url) {
        console.log(`  ⏭️  ${concept.slug} (already has thumbnail)`)
        success++
        continue
      }

      // Download original
      const imageBuffer = await downloadImage(concept.image_url)

      // Create thumbnail
      const thumbBuffer = await createThumbnail(imageBuffer)

      // Generate filename from slug
      const thumbFilename = `${concept.slug}.jpg`

      // Upload
      const thumbnailUrl = await uploadThumbnail(thumbBuffer, thumbFilename)

      // Update database
      await updateConceptThumbnail(concept.id, thumbnailUrl)

      const originalKB = Math.round(imageBuffer.length / 1024)
      const thumbKB = Math.round(thumbBuffer.length / 1024)
      console.log(`  ✅ ${concept.slug}: ${originalKB}KB → ${thumbKB}KB`)

      success++
    } catch (error) {
      console.error(`  ❌ ${concept.slug}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      failed++
    }
  }

  return { success, failed }
}

async function main() {
  console.log('🖼️  Thumbnail Generator')
  console.log('========================\n')

  // Check if thumbnail_url column exists by trying to select it
  const { error: schemaError } = await supabase
    .from('concepts')
    .select('thumbnail_url')
    .limit(1)

  if (schemaError?.message.includes('thumbnail_url')) {
    console.error('❌ The "thumbnail_url" column does not exist in the concepts table.')
    console.error('\n   Run this SQL in Supabase Dashboard → SQL Editor:\n')
    console.error('   ALTER TABLE concepts ADD COLUMN thumbnail_url TEXT;\n')
    process.exit(1)
  }

  // Fetch all concepts
  console.log('📋 Fetching concepts...')
  const { data: concepts, error } = await supabase
    .from('concepts')
    .select('id, slug, image_url, thumbnail_url')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('❌ Failed to fetch concepts:', error.message)
    process.exit(1)
  }

  if (!concepts || concepts.length === 0) {
    console.log('No concepts found.')
    process.exit(0)
  }

  const needsProcessing = concepts.filter(c => !c.thumbnail_url)
  console.log(`📊 Total: ${concepts.length}, Need thumbnails: ${needsProcessing.length}\n`)

  if (needsProcessing.length === 0) {
    console.log('✅ All concepts already have thumbnails!')
    process.exit(0)
  }

  // Process in batches of 10 (to avoid overwhelming the network)
  const BATCH_SIZE = 10
  const batches = []
  for (let i = 0; i < needsProcessing.length; i += BATCH_SIZE) {
    batches.push(needsProcessing.slice(i, i + BATCH_SIZE))
  }

  let totalSuccess = 0
  let totalFailed = 0

  for (let i = 0; i < batches.length; i++) {
    console.log(`\n📦 Batch ${i + 1}/${batches.length}`)
    const { success, failed } = await processConceptBatch(batches[i], i + 1, batches.length)
    totalSuccess += success
    totalFailed += failed
  }

  console.log('\n========================')
  console.log(`✅ Success: ${totalSuccess}`)
  console.log(`❌ Failed: ${totalFailed}`)
  console.log('========================\n')

  if (totalFailed > 0) {
    console.log('Some thumbnails failed. Re-run the script to retry failed ones.')
  }
}

main().catch(console.error)
