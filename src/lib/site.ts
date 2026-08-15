/**
 * Canonical origin for the site.
 *
 * `.trim()` matters: the Vercel env var has historically carried a trailing
 * newline, which produced a robots.txt whose `Sitemap:` directive was split
 * across two lines and therefore unparseable.
 *
 * The fallback must be the real production host. It used to be
 * `canyouimagine.com`, which belongs to an unrelated business.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.canyouimagine.lol')
  .trim()
  .replace(/\/+$/, '')

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
