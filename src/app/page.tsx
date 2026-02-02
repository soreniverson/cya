import { Metadata } from 'next'
import { getAllConcepts, getCategories } from '@/lib/queries'
import { CanvasViewer } from '@/components/canvas/CanvasViewer'

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

  return <CanvasViewer concepts={concepts} categories={categories} />
}
