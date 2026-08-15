'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fromStoragePath } from '@/lib/storage'
import type { CanvasConcept } from '@/lib/types'

interface ConceptLightboxProps {
  concept: CanvasConcept | null
  onClose: () => void
}

export function ConceptLightbox({ concept, onClose }: ConceptLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && concept) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [concept, onClose])

  // Move focus into the dialog on open, and restore it on close.
  useEffect(() => {
    if (concept) {
      openerRef.current = document.activeElement as HTMLElement | null
      closeRef.current?.focus()
    } else {
      openerRef.current?.focus()
      openerRef.current = null
    }
  }, [concept])

  const formattedDate = concept?.date_posted
    ? new Date(concept.date_posted).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <div
      inert={!concept}
      role="dialog"
      aria-modal="true"
      aria-labelledby={concept ? 'lightbox-title' : undefined}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-150",
        concept
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      )}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          "relative w-full max-w-md max-h-[90vh] overflow-hidden transition-all duration-150",
          concept ? "scale-100" : "scale-95"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-surface overflow-hidden">
          {/* Close button */}
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close concept"
            className="absolute top-4 right-4 z-10 size-8 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/60 transition-colors duration-150"
          >
            <X className="size-4" />
          </button>

          {/* Image */}
          {concept && (
            <div className="relative aspect-square w-full bg-neutral-900">
              <Image
                src={fromStoragePath(concept.mid_url || concept.image_url) as string}
                alt={concept.title}
                fill
                className="object-contain"
                unoptimized
                priority
              />
            </div>
          )}

          {/* Content */}
          {concept && (
            <div className="p-5 space-y-3">
              {/* Title */}
              <h2 id="lightbox-title" className="text-lg font-medium text-white">{concept.title}</h2>

              {/* Meta */}
              <div className="flex items-center gap-2 text-sm">
                {concept.category && (
                  <span className="text-neutral-300">{concept.category}</span>
                )}
                {concept.category && formattedDate && (
                  <span className="text-neutral-600">·</span>
                )}
                {formattedDate && (
                  <span className="text-neutral-500">{formattedDate}</span>
                )}
              </div>

              {/* Caption */}
              {concept.caption && (
                <p className="text-neutral-400 text-sm leading-relaxed">
                  {concept.caption}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Custom styles */}
      <style jsx>{`
        .modal-surface {
          background: rgba(23, 23, 23, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
        }
      `}</style>
    </div>
  )
}
