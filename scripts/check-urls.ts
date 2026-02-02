import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  const { data, error } = await supabase
    .from('concepts')
    .select('id, image_url, thumbnail_url, mid_url')
    .limit(10)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Sample database URLs:\n')
  for (const row of data) {
    console.log(`ID: ${row.id}`)
    console.log(`  image_url:     ${row.image_url}`)
    console.log(`  thumbnail_url: ${row.thumbnail_url}`)
    console.log(`  mid_url:       ${row.mid_url}`)
    console.log()
  }

  // Count nulls
  const { data: counts } = await supabase
    .from('concepts')
    .select('id, thumbnail_url, mid_url')

  const withThumb = counts?.filter(r => r.thumbnail_url).length || 0
  const withMid = counts?.filter(r => r.mid_url).length || 0
  const total = counts?.length || 0

  console.log(`\nTotal concepts: ${total}`)
  console.log(`With thumbnail_url: ${withThumb}`)
  console.log(`With mid_url: ${withMid}`)
}

main().catch(console.error)
