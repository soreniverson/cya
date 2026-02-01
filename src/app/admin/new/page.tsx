import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ConceptForm } from '@/components/admin/concept-form'

export default async function NewConceptPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get existing categories for autocomplete
  const { data: categoriesData } = await supabase
    .from('concepts')
    .select('category')
    .not('category', 'is', null)

  const categories = [...new Set(
    (categoriesData ?? [])
      .map((c) => c.category)
      .filter(Boolean) as string[]
  )].sort()

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link
            href="/admin"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Admin
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-medium mb-8">New Concept</h1>
        <ConceptForm categories={categories} />
      </div>
    </main>
  )
}
