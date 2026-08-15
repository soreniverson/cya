import { Metadata } from 'next'
import Link from 'next/link'
import { getAllConcepts, getCategories } from '@/lib/queries'
import { CanvasViewer } from '@/components/canvas/CanvasViewer'
import { ArchiveIndex } from '@/components/archive-index'

export const metadata: Metadata = {
  title: 'Can You Imagine',
  description: 'Explore AI-generated concepts in an infinite canvas. Pan, zoom, and discover.',
}

export const revalidate = 3600 // Revalidate every hour

export default async function HomePage() {
  const [concepts, categories] = await Promise.all([
    getAllConcepts(),
    getCategories(),
  ])

  // The canvas grid math divides by the concept count. With an empty archive
  // that produces a zero-width tile and a non-terminating render loop, so never
  // mount the canvas without something to draw.
  if (concepts.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-medium">Can You Imagine</h1>
          <p className="text-muted-foreground">
            The archive is unavailable right now. Please try again shortly.
          </p>
          <Link
            href="/directory"
            className="inline-block text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            Browse the directory
          </Link>
        </div>
      </main>
    )
  }

  return (
    <>
      <CanvasViewer concepts={concepts} categories={categories} />
      <ArchiveIndex concepts={concepts} />
    </>
  )
}
