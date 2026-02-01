'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Check, Link as LinkIcon } from 'lucide-react'

export function ShareButton() {
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    const url = window.location.href

    // Try native share API on mobile
    if (navigator.share) {
      try {
        await navigator.share({
          title: document.title,
          url,
        })
        return
      } catch {
        // User cancelled or share failed, fall through to copy
      }
    }

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      console.error('Failed to copy')
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleShare}
      className="text-muted-foreground hover:text-foreground"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4 mr-2" />
          Copied
        </>
      ) : (
        <>
          <LinkIcon className="h-4 w-4 mr-2" />
          Share
        </>
      )}
    </Button>
  )
}
