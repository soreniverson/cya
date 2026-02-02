'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { Concept } from '@/lib/types'

interface ConceptCardProps {
  concept: Concept
  priority?: boolean
}

export function ConceptCard({ concept, priority = false }: ConceptCardProps) {
  const formattedDate = concept.date_posted
    ? new Date(concept.date_posted).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  return (
    <Link
      href={`/c/${concept.slug}`}
      className="group block"
    >
      <div className="relative aspect-square overflow-hidden bg-[#111]">
        <Image
          src={concept.thumbnail_url || concept.image_url}
          alt={concept.title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="object-cover transition-transform duration-150 group-hover:scale-[1.02]"
          priority={priority}
        />
      </div>
      <div className="mt-3 space-y-1">
        <h3 className="text-sm font-medium text-foreground leading-tight group-hover:text-muted-foreground transition-colors duration-150">
          {concept.title}
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {concept.category && (
            <Badge variant="secondary" className="text-xs font-normal px-2 py-0">
              {concept.category}
            </Badge>
          )}
          {formattedDate && <span>{formattedDate}</span>}
        </div>
      </div>
    </Link>
  )
}
