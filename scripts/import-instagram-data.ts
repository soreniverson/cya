/**
 * Import captions and dates from Instagram export to concepts database
 * Matches Instagram caption directly to concept title
 *
 * Usage:
 *   npx tsx scripts/import-instagram-data.ts --dry-run    # Preview
 *   npx tsx scripts/import-instagram-data.ts              # Apply
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface InstagramPost {
  caption: string
  date: string
}

// Parse "Mon DD, YYYY" to "YYYY-MM-DD"
function parseDate(dateStr: string): string {
  return new Date(dateStr).toISOString().split('T')[0]
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run')
  console.log(isDryRun ? '🔍 DRY RUN\n' : '📝 APPLYING\n')

  // Load Instagram data - parse line by line due to malformed JSON
  const lines = fs.readFileSync(
    '/Users/soreniverson/Downloads/instagram-soren.iverson-2026-02-01-eNEUlNt0/your_instagram_activity/media/posts_data.json',
    'utf-8'
  ).split('\n')

  const posts: InstagramPost[] = []
  let currentCaption = ''
  let currentDate = ''

  for (const line of lines) {
    const captionMatch = line.match(/"caption":\s*"(.+)"/)
    const dateMatch = line.match(/"date":\s*"(.+)"/)

    if (captionMatch) {
      // Extract everything between first and last quote after "caption":
      const start = line.indexOf('"caption"') + 12 // skip "caption": "
      const end = line.lastIndexOf('"')
      currentCaption = line.slice(start, end)
    }
    if (dateMatch) {
      currentDate = dateMatch[1]
    }

    // When we have both, save and reset
    if (currentCaption && currentDate) {
      posts.push({ caption: currentCaption, date: currentDate })
      currentCaption = ''
      currentDate = ''
    }
  }
  console.log(`📸 ${posts.length} Instagram posts\n`)

  // Fetch concepts
  const { data: concepts, error } = await supabase
    .from('concepts')
    .select('id, title, caption, date_posted')

  if (error) throw error
  console.log(`📚 ${concepts.length} concepts in DB\n`)

  // Create lookup by date (since titles are placeholders like "Concept July 18, 2025")
  const conceptsByDate = new Map<string, typeof concepts[0]>()
  for (const c of concepts) {
    if (c.date_posted) {
      conceptsByDate.set(c.date_posted, c)
    }
  }

  const matched: Array<{ post: InstagramPost; concept: typeof concepts[0] }> = []
  const unmatched: InstagramPost[] = []

  for (const post of posts) {
    const postDate = parseDate(post.date)
    const concept = conceptsByDate.get(postDate)

    if (concept) {
      matched.push({ post, concept })
    } else {
      unmatched.push(post)
    }
  }

  // Report
  console.log(`✅ Matched: ${matched.length}`)
  console.log(`❌ Unmatched: ${unmatched.length}\n`)

  if (matched.length > 0) {
    console.log('MATCHES (first 10):')
    for (const { post, concept } of matched.slice(0, 10)) {
      console.log(`  "${post.caption.slice(0, 50)}..." → ${parseDate(post.date)}`)
    }
    if (matched.length > 10) console.log(`  ... +${matched.length - 10} more\n`)
  }

  if (unmatched.length > 0) {
    console.log('UNMATCHED:')
    for (const post of unmatched.slice(0, 20)) {
      console.log(`  - "${post.caption.slice(0, 60)}"`)
    }
    if (unmatched.length > 20) console.log(`  ... +${unmatched.length - 20} more`)
  }

  // Apply
  if (!isDryRun && matched.length > 0) {
    console.log('\n🚀 Updating...')
    let ok = 0, fail = 0

    for (const { post, concept } of matched) {
      const { error } = await supabase
        .from('concepts')
        .update({
          title: post.caption,  // Update title from Instagram caption
        })
        .eq('id', concept.id)

      error ? fail++ : ok++
    }

    console.log(`✅ ${ok} updated, ❌ ${fail} failed`)
  }

  if (isDryRun) console.log('\n💡 Run without --dry-run to apply')
}

main().catch(console.error)
