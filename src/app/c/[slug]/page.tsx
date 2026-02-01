import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, ChevronLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ShareButton } from '@/components/share-button'
import { getConceptBySlug, getAdjacentConcepts } from '@/lib/queries'
import { createStaticClient } from '@/lib/supabase/static'
import type { Metadata } from 'next'

interface ConceptPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ category?: string }>
}

export async function generateMetadata({ params }: ConceptPageProps): Promise<Metadata> {
  const { slug } = await params
  const concept = await getConceptBySlug(slug)

  if (!concept) {
    return { title: 'Concept Not Found' }
  }

  const description = concept.caption
    ? concept.caption.slice(0, 160)
    : `A satirical UI/UX concept by Soren Iverson`

  return {
    title: `${concept.title} | Can You Imagine`,
    description,
    openGraph: {
      title: concept.title,
      description,
      images: [{ url: concept.image_url, width: concept.image_width, height: concept.image_height }],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: concept.title,
      description,
      images: [concept.image_url],
    },
  }
}

export async function generateStaticParams() {
  const supabase = createStaticClient()

  // Return empty array if no client (env vars not set during build)
  // Pages will be generated on-demand
  if (!supabase) {
    return []
  }

  const { data } = await supabase
    .from('concepts')
    .select('slug')
    .eq('is_published', true)
    .limit(100)

  return (data ?? []).map((concept) => ({
    slug: concept.slug,
  }))
}

export default async function ConceptPage({ params, searchParams }: ConceptPageProps) {
  const { slug } = await params
  const { category } = await searchParams

  const concept = await getConceptBySlug(slug)

  if (!concept) {
    notFound()
  }

  const { prev, next } = await getAdjacentConcepts(slug, category)

  const formattedDate = concept.date_posted
    ? new Date(concept.date_posted).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  // Build back URL with category filter if present
  const backUrl = category ? `/?category=${encodeURIComponent(category)}` : '/'

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              href={backUrl}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Link>
            <ShareButton />
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-[1fr,320px] gap-8">
          {/* Image */}
          <div className="relative aspect-square bg-[#111] overflow-hidden">
            <Image
              src={concept.image_url}
              alt={concept.title}
              fill
              sizes="(max-width: 1024px) 100vw, 800px"
              className="object-contain"
              priority
            />
          </div>

          {/* Details */}
          <div className="space-y-6">
            <div className="space-y-3">
              <h1 className="text-2xl font-medium tracking-tight">{concept.title}</h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                {concept.category && (
                  <Link href={`/?category=${encodeURIComponent(concept.category)}`}>
                    <Badge variant="secondary" className="hover:bg-accent transition-colors">
                      {concept.category}
                    </Badge>
                  </Link>
                )}
                {formattedDate && <span>{formattedDate}</span>}
              </div>
            </div>

            {concept.caption && (
              <p className="text-muted-foreground leading-relaxed">{concept.caption}</p>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-6 border-t border-border">
              {prev ? (
                <Link
                  href={`/c/${prev.slug}${category ? `?category=${encodeURIComponent(category)}` : ''}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="max-w-[120px] truncate">{prev.title}</span>
                </Link>
              ) : (
                <div />
              )}
              {next ? (
                <Link
                  href={`/c/${next.slug}${category ? `?category=${encodeURIComponent(category)}` : ''}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="max-w-[120px] truncate">{next.title}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <div />
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
