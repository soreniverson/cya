import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  // Find concepts without mid_url
  const { data, error } = await supabase
    .from('concepts')
    .select('id, title, image_url, mid_url')
    .is('mid_url', null)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log(`Concepts missing mid_url: ${data.length}\n`)
  for (const row of data) {
    console.log(`${row.title}`)
    console.log(`  image_url: ${row.image_url}`)
    console.log()
  }
}

main().catch(console.error)
