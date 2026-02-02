import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables from .env.local
config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function listAllFiles(bucket: string, folder: string = '') {
  const allFiles: string[] = []
  let offset = 0
  const limit = 1000

  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folder, { limit, offset })

    if (error) {
      console.error('Error listing files:', error)
      break
    }

    if (!data || data.length === 0) break

    for (const item of data) {
      const path = folder ? `${folder}/${item.name}` : item.name

      // If it's a folder, recurse
      if (item.id === null) {
        const subFiles = await listAllFiles(bucket, path)
        allFiles.push(...subFiles)
      } else {
        allFiles.push(path)
      }
    }

    if (data.length < limit) break
    offset += limit
  }

  return allFiles
}

async function main() {
  console.log('Listing all files in concepts bucket...\n')

  const allFiles = await listAllFiles('concepts')

  // Categorize files by folder
  const byFolder = new Map<string, string[]>()

  for (const file of allFiles) {
    const parts = file.split('/')
    const folder = parts.length > 1 ? parts[0] : '(root)'
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    byFolder.get(folder)!.push(file)
  }

  console.log(`Total files: ${allFiles.length}\n`)
  console.log('Files by folder:')
  for (const [folder, files] of byFolder) {
    console.log(`  ${folder}: ${files.length} files`)
  }

  // Show sample from each folder
  console.log('\nSample files from each folder:')
  for (const [folder, files] of byFolder) {
    console.log(`\n${folder}:`)
    files.slice(0, 3).forEach(f => console.log(`  ${f}`))
  }

  // For deletion, we want root files that match concept-YYYY-MM-DD.png pattern
  // These are the large originals - keep thumbnails/, mid/, and any other files
  const filesToDelete = allFiles.filter(f => {
    // Only delete files in root (no folder prefix)
    if (f.includes('/')) return false
    // Only delete files matching the concept date pattern
    return /^concept-\d{4}-\d{2}-\d{2}\.png$/.test(f)
  })

  console.log(`\nFiles to delete (everything except mid/): ${filesToDelete.length}`)

  // Check if --delete flag is passed
  if (process.argv.includes('--delete')) {
    console.log(`\n⚠️  Deleting ${filesToDelete.length} files (keeping mid/ only)...`)

    // Delete in batches of 100
    const batchSize = 100
    let deleted = 0

    for (let i = 0; i < filesToDelete.length; i += batchSize) {
      const batch = filesToDelete.slice(i, i + batchSize)
      const { error } = await supabase.storage
        .from('concepts')
        .remove(batch)

      if (error) {
        console.error(`Error deleting batch ${i / batchSize + 1}:`, error)
      } else {
        deleted += batch.length
        console.log(`  Deleted ${deleted}/${filesToDelete.length}`)
      }
    }

    console.log('\n✅ Done!')
  } else {
    console.log('\nRun with --delete flag to remove these files (keeping only mid/)')
  }
}

main().catch(console.error)
