'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Concept } from '@/lib/types'

interface ConceptLightboxProps {
  concept: Concept | null
  onClose: () => void
}

export function ConceptLightbox({ concept, onClose }: ConceptLightboxProps) {
  if (!concept) return null

  const formattedDate = concept.date_posted
    ? new Date(concept.date_posted).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <Dialog open={!!concept} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{concept.title}</DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-sm">
            {concept.category && (
              <span className="text-primary">{concept.category}</span>
            )}
            {concept.category && formattedDate && (
              <span className="text-muted-foreground">·</span>
            )}
            {formattedDate && (
              <span className="text-muted-foreground">{formattedDate}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-secondary">
          <Image
            src={concept.image_url}
            alt={concept.title}
            fill
            className="object-contain"
            sizes="(max-width: 768px) 100vw, 700px"
            priority
          />
        </div>

        {concept.caption && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {concept.caption}
          </p>
        )}

        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href={`/c/${concept.slug}`}>
              View full page
              <ExternalLink className="size-3 ml-1" />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
