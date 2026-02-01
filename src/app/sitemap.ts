import { createStaticClient } from '@/lib/supabase/static'
import type { MetadataRoute } from 'next'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://canyouimagine.com'

  const supabase = createStaticClient()

  // Return just home page if no client (env vars not set during build)
  if (!supabase) {
    return [
      {
        url: baseUrl,
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: 1,
      },
    ]
  }

  const { data: concepts } = await supabase
    .from('concepts')
    .select('slug, updated_at')
    .eq('is_published', true)
    .order('date_posted', { ascending: false })

  const conceptUrls: MetadataRoute.Sitemap = (concepts ?? []).map((concept) => ({
    url: `${baseUrl}/c/${concept.slug}`,
    lastModified: concept.updated_at,
    changeFrequency: 'monthly',
    priority: 0.8,
  }))

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...conceptUrls,
  ]
}
