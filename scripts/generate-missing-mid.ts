import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const TEMP_DIR = '/tmp/missing-mid'

async function downloadFile(url: string, filename: string): Promise<string> {
  const filepath = path.join(TEMP_DIR, filename)
  execSync(`curl -s -o "${filepath}" "${url}"`)
  return filepath
}

async function main() {
  // Create temp directory
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
  }

  // Find concepts without mid_url
  const { data: concepts, error } = await supabase
    .from('concepts')
    .select('id, title, image_url')
    .is('mid_url', null)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log(`Processing ${concepts.length} concepts without mid_url...\n`)

  for (const concept of concepts) {
    console.log(`\nProcessing: ${concept.title}`)

    // Extract filename from URL
    const urlParts = concept.image_url.split('/')
    const originalFilename = urlParts[urlParts.length - 1]
    const baseName = originalFilename.replace(/\.[^.]+$/, '')
    const midFilename = `${baseName}.jpg`

    // Download original
    console.log('  Downloading original...')
    const localPath = await downloadFile(concept.image_url, originalFilename)

    // Resize to 800px width
    console.log('  Resizing to 800px...')
    const midPath = path.join(TEMP_DIR, midFilename)
    execSync(`sips -Z 800 "${localPath}" --setProperty format jpeg --out "${midPath}" 2>/dev/null`)

    // Upload to Supabase
    console.log('  Uploading mid-res...')
    const fileBuffer = fs.readFileSync(midPath)
    const storagePath = `mid/${midFilename}`

    const { error: uploadError } = await supabase.storage
      .from('concepts')
      .upload(storagePath, fileBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      })

    if (uploadError) {
      console.error(`  Error uploading: ${uploadError.message}`)
      continue
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('concepts')
      .getPublicUrl(storagePath)

    // Update database
    console.log('  Updating database...')
    const { error: updateError } = await supabase
      .from('concepts')
      .update({ mid_url: publicUrl })
      .eq('id', concept.id)

    if (updateError) {
      console.error(`  Error updating: ${updateError.message}`)
      continue
    }

    console.log(`  ✅ Done: ${publicUrl}`)

    // Cleanup temp files
    fs.unlinkSync(localPath)
    fs.unlinkSync(midPath)
  }

  console.log('\n✅ All done!')
}

main().catch(console.error)
