import { createStaticClient } from '@/lib/supabase/static'
import { SITE_URL } from '@/lib/site'
import type { MetadataRoute } from 'next'

// Without this the sitemap is prerendered once at deploy and then frozen, so
// concepts added afterwards never appear and renamed slugs linger as 404s.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = SITE_URL

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
