import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SITE_URL } from '@/lib/site'

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/', SITE_URL), { status: 303 })
}
