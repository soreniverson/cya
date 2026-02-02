export interface Concept {
  id: string
  slug: string
  title: string
  caption: string | null
  image_url: string
  thumbnail_url: string | null
  image_width: number
  image_height: number
  category: string | null
  date_posted: string | null
  is_published: boolean
  created_at: string
  updated_at: string
}

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
