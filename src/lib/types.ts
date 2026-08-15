export interface Concept {
  id: string
  slug: string
  title: string
  caption: string | null
  image_url: string
  thumbnail_url: string | null  // ~300px wide for zoomed-out canvas
  mid_url: string | null        // ~800px wide for zoomed-in canvas
  image_width: number
  image_height: number
  category: string | null
  date_posted: string | null
  is_published: boolean
  created_at: string
  updated_at: string
}

/**
 * The subset the infinite canvas needs. The homepage serialises every published
 * row into its payload, so it deliberately omits `search_vector`, `is_published`,
 * `created_at`, `updated_at` and the image dimensions - none of which the canvas
 * or its lightbox read.
 */
export type CanvasConcept = Pick<
  Concept,
  | 'id'
  | 'slug'
  | 'title'
  | 'caption'
  | 'image_url'
  | 'thumbnail_url'
  | 'mid_url'
  | 'category'
  | 'date_posted'
>

export interface ConceptWithCount {
  concepts: Concept[]
  totalCount: number
}

export interface Category {
  category: string
  count: number
}

export interface ConceptFormData {
  title: string
  caption: string
  category: string
  date_posted: string
  is_published: boolean
}
