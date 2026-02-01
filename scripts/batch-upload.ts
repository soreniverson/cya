import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing environment variables!')
  console.error('')
  console.error('Required:')
  console.error('  NEXT_PUBLIC_SUPABASE_URL - Your Supabase project URL')
  console.error('  SUPABASE_SERVICE_ROLE_KEY - Service role key (from Supabase Dashboard > Settings > API)')
  console.error('')
  console.error('Run with:')
  console.error('  SUPABASE_SERVICE_ROLE_KEY=your_key npm run batch-upload')
  process.exit(1)
}

const IDEAS_FOLDER = '/Users/soreniverson/Desktop/ideas/2023'
const BUCKET_NAME = 'concepts'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

interface UploadResult {
  success: boolean
  file: string
  error?: string
}

function parseFilename(filename: string): { date: Date; slug: string } | null {
  // Pattern: MM-DD-YY.png
  const match = filename.match(/^(\d{2})-(\d{2})-(\d{2})\.png$/i)
  if (!match) return null

  const [, month, day, year] = match
  const fullYear = 2000 + parseInt(year, 10)
  const date = new Date(fullYear, parseInt(month, 10) - 1, parseInt(day, 10))

  // Create slug from date: concept-2023-01-01
  const slug = `concept-${fullYear}-${month}-${day}`

  return { date, slug }
}

function getAllPngFiles(dir: string): string[] {
  const files: string[] = []

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...getAllPngFiles(fullPath))
    } else if (entry.name.toLowerCase().endsWith('.png')) {
      files.push(fullPath)
    }
  }

  return files
}

async function uploadFile(filePath: string): Promise<UploadResult> {
  const filename = path.basename(filePath)
  const parsed = parseFilename(filename)

  if (!parsed) {
    return { success: false, file: filePath, error: `Could not parse filename: ${filename}` }
  }

  const { date, slug } = parsed
  const fileBuffer = fs.readFileSync(filePath)
  const storagePath = `${slug}.png`

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, fileBuffer, {
      contentType: 'image/png',
      upsert: true, // Overwrite if exists
    })

  if (uploadError) {
    return { success: false, file: filePath, error: `Storage upload failed: ${uploadError.message}` }
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(storagePath)

  // Insert into database
  const { error: dbError } = await supabase
    .from('concepts')
    .upsert({
      slug,
      title: `Concept ${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      caption: null, // To be filled in later
      image_url: urlData.publicUrl,
      category: null, // To be filled in later
      date_posted: date.toISOString().split('T')[0],
    }, {
      onConflict: 'slug',
    })

  if (dbError) {
    return { success: false, file: filePath, error: `Database insert failed: ${dbError.message}` }
  }

  return { success: true, file: filePath }
}

async function main() {
  console.log('🚀 Starting batch upload...')
  console.log(`📁 Source folder: ${IDEAS_FOLDER}`)
  console.log(`🗄️  Supabase URL: ${SUPABASE_URL}`)
  console.log('')

  // Get all PNG files
  const files = getAllPngFiles(IDEAS_FOLDER)
  console.log(`📷 Found ${files.length} PNG files`)
  console.log('')

  // Process in batches of 10 to avoid rate limiting
  const BATCH_SIZE = 10
  let successCount = 0
  let failCount = 0
  const failures: UploadResult[] = []

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(uploadFile))

    for (const result of results) {
      if (result.success) {
        successCount++
        process.stdout.write('✓')
      } else {
        failCount++
        failures.push(result)
        process.stdout.write('✗')
      }
    }

    // Progress update every 50 files
    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= files.length) {
      console.log(` (${Math.min(i + BATCH_SIZE, files.length)}/${files.length})`)
    }
  }

  console.log('')
  console.log('━'.repeat(50))
  console.log(`✅ Successful uploads: ${successCount}`)
  console.log(`❌ Failed uploads: ${failCount}`)

  if (failures.length > 0) {
    console.log('')
    console.log('Failed files:')
    for (const failure of failures) {
      console.log(`  - ${path.basename(failure.file)}: ${failure.error}`)
    }
  }

  console.log('')
  console.log('🎉 Batch upload complete!')
}

main().catch(console.error)
