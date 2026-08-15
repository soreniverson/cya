import Link from 'next/link'
import type { CanvasConcept } from '@/lib/types'

interface ArchiveIndexProps {
  concepts: CanvasConcept[]
}

/**
 * The homepage renders entirely inside a <canvas>, so to a crawler or a screen
 * reader it is a blank document: no heading, no links, no route to any of the
 * concept pages. This supplies that structure.
 *
 * `sr-only` keeps it clipped to a 1px box, so nothing here changes what a
 * sighted user sees - it exists purely for assistive tech and crawlers.
 */
export function ArchiveIndex({ concepts }: ArchiveIndexProps) {
  return (
    <div className="sr-only">
      <h1>Can You Imagine — an archive of {concepts.length} satirical interface concepts by Soren Iverson</h1>
      <p>
        The archive is presented as an infinite canvas you can pan and zoom. Every
        concept is also listed below, and{' '}
        <Link href="/directory">the searchable directory</Link> offers the same
        collection with search and category filters.
      </p>
      <nav aria-label="All concepts">
        <ul>
          {concepts.map((concept) => (
            <li key={concept.id}>
              <Link href={`/c/${concept.slug}`}>
                {concept.title}
                {concept.category ? ` — ${concept.category}` : ''}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
