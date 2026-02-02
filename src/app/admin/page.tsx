import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AdminConceptList } from '@/components/admin/concept-list'
import { Button } from '@/components/ui/button'
import { Plus, LogOut } from 'lucide-react'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get all concepts for admin view
  const { data: concepts, count } = await supabase
    .from('concepts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  // Get unique categories for autocomplete
  const categories = [...new Set(
    (concepts ?? [])
      .map(c => c.category)
      .filter((c): c is string => !!c)
  )].sort()

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-lg font-medium tracking-tight">
                Can You Imagine
              </Link>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">Admin</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/admin/new">
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  New Concept
                </Button>
              </Link>
              <form action="/api/auth/signout" method="POST">
                <Button type="submit" variant="ghost" size="sm">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-medium">Concepts</h1>
          <p className="text-sm text-muted-foreground mt-1">{count ?? 0} total concepts</p>
        </div>

        <AdminConceptList concepts={concepts ?? []} categories={categories} />
      </div>
    </main>
  )
}
