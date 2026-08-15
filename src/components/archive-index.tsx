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
 *
 * Plain <a>, deliberately, not next/link. These links are never visible and
 * never clicked by a sighted user, so the 964 Link components this used to
 * mount were pure hydration and prefetch-observer overhead for markup that
 * only ever needs to be read.
 */
export function ArchiveIndex({ concepts }: ArchiveIndexProps) {
  return (
    <div className="sr-only">
      <h1>Can You Imagine — an archive of {concepts.length} satirical interface concepts by Soren Iverson</h1>
      <p>
        The archive is presented as an infinite canvas you can pan and zoom. Every
        concept is also listed below, and{' '}
        <a href="/directory">the searchable directory</a> offers the same
        collection with search and category filters.
      </p>
      <nav aria-label="All concepts">
        <ul>
          {concepts.map((concept) => (
            <li key={concept.slug}>
              <a href={`/c/${concept.slug}`}>
                {concept.title}
                {concept.category ? ` — ${concept.category}` : ''}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
