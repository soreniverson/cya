import { Metadata } from 'next'
import { getAllConcepts, getCategories } from '@/lib/queries'
import { CanvasViewer } from '@/components/canvas/CanvasViewer'

export const metadata: Metadata = {
  title: 'Canvas View | Can You Imagine',
  description: 'Explore the entire concept library in an infinite canvas view. Pan, zoom, and discover AI-generated concepts.',
}

export const revalidate = 3600 // Revalidate every hour

export default async function CanvasPage() {
  const [concepts, categories] = await Promise.all([
    getAllConcepts(),
    getCategories(),
  ])

  return <CanvasViewer concepts={concepts} categories={categories} />
}
