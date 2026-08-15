'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Upload, X } from 'lucide-react'
import type { Concept } from '@/lib/types'

interface ConceptFormProps {
  concept?: Concept
  categories: string[]
}

function generateSlug(category: string, title: string): string {
  const base = `${category || 'concept'}/${title || 'untitled'}`
  return base
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function ConceptForm({ concept, categories }: ConceptFormProps) {
  const router = useRouter()
  const isEditing = !!concept

  const [title, setTitle] = useState(concept?.title ?? '')
  const [caption, setCaption] = useState(concept?.caption ?? '')
  const [category, setCategory] = useState(concept?.category ?? '')
  const [slug, setSlug] = useState(concept?.slug ?? '')
  const [useCustomSlug, setUseCustomSlug] = useState(isEditing) // Preserve existing slug when editing
  const [datePosted, setDatePosted] = useState(concept?.date_posted ?? '')
  const [isPublished, setIsPublished] = useState(concept?.is_published ?? true)
  const [imageUrl, setImageUrl] = useState(concept?.image_url ?? '')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(concept?.thumbnail_url ?? concept?.image_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-generate slug when title/category changes (only if not using custom slug)
  const autoSlug = generateSlug(category, title)
  const effectiveSlug = useCustomSlug ? slug : autoSlug

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }, [])

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }, [])

  const removeImage = useCallback(() => {
    setImageFile(null)
    setImagePreview(null)
    setImageUrl('')
  }, [])

  // Derived sizes, matching scripts/generate-thumbnails.ts and the existing
  // `thumbnails/<stem>.jpg` / `mid/<stem>.jpg` layout in the bucket.
  const THUMB_WIDTH = 150
  const MID_WIDTH = 800
  const JPEG_QUALITY = 0.82

  /** Downscale to `maxWidth` (never upscale) and encode as JPEG. */
  const resizeToJpeg = async (
    bitmap: ImageBitmap,
    maxWidth: number
  ): Promise<Blob> => {
    const scale = Math.min(1, maxWidth / bitmap.width)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get a 2D canvas context')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    )
    if (!blob) throw new Error('Could not encode the resized image')
    return blob
  }

  interface UploadedImage {
    imageUrl: string
    thumbnailUrl: string
    midUrl: string
    width: number
    height: number
  }

  /**
   * Uploads the original plus both derived sizes.
   *
   * Every display surface prefers `thumbnail_url` / `mid_url` over `image_url`,
   * so writing only the original means a replaced image never actually appears
   * anywhere, and a new concept falls back to a multi-megabyte PNG in a 72px
   * canvas tile.
   */
  const uploadImage = async (file: File): Promise<UploadedImage> => {
    const supabase = createClient()
    const fileExt = file.name.split('.').pop() || 'png'
    const stem = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const fileName = `${stem}.${fileExt}`

    const bitmap = await createImageBitmap(file)
    const [thumbBlob, midBlob] = await Promise.all([
      resizeToJpeg(bitmap, THUMB_WIDTH),
      resizeToJpeg(bitmap, MID_WIDTH),
    ])
    const { width, height } = bitmap
    bitmap.close()

    const uploads: Array<[string, Blob, string]> = [
      [fileName, file, file.type || 'image/png'],
      [`thumbnails/${stem}.jpg`, thumbBlob, 'image/jpeg'],
      [`mid/${stem}.jpg`, midBlob, 'image/jpeg'],
    ]

    for (const [path, body, contentType] of uploads) {
      const { error } = await supabase.storage.from('concepts').upload(path, body, {
        cacheControl: '31536000',
        contentType,
        upsert: false,
      })
      if (error) throw error
    }

    const publicUrl = (path: string) =>
      supabase.storage.from('concepts').getPublicUrl(path).data.publicUrl

    return {
      imageUrl: publicUrl(fileName),
      thumbnailUrl: publicUrl(`thumbnails/${stem}.jpg`),
      midUrl: publicUrl(`mid/${stem}.jpg`),
      width,
      height,
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!title.trim()) {
      setError('Title is required')
      return
    }

    if (!imageUrl && !imageFile) {
      setError('Image is required')
      return
    }

    setSaving(true)

    try {
      const supabase = createClient()

      // Upload new image if selected
      let uploaded: UploadedImage | null = null
      if (imageFile) {
        setUploading(true)
        try {
          uploaded = await uploadImage(imageFile)
        } finally {
          setUploading(false)
        }
      }

      const conceptData = {
        slug: effectiveSlug,
        title: title.trim(),
        caption: caption.trim() || null,
        category: category.trim() || null,
        date_posted: datePosted || null,
        is_published: isPublished,
        // Write all three tiers together. Leaving thumbnail_url/mid_url stale
        // is what made image replacement a silent no-op.
        ...(uploaded
          ? {
              image_url: uploaded.imageUrl,
              thumbnail_url: uploaded.thumbnailUrl,
              mid_url: uploaded.midUrl,
              image_width: uploaded.width,
              image_height: uploaded.height,
            }
          : { image_url: imageUrl }),
      }

      if (isEditing) {
        const { error } = await supabase
          .from('concepts')
          .update(conceptData)
          .eq('id', concept.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('concepts')
          .insert(conceptData)

        if (error) throw error
      }

      router.push('/admin')
      router.refresh()
    } catch (err) {
      console.error('Error saving concept:', err)
      setError(err instanceof Error ? err.message : 'Failed to save concept')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Image Upload */}
      <div className="space-y-2">
        <Label>Image</Label>
        {imagePreview ? (
          <div className="relative w-full max-w-md aspect-square bg-[#111] rounded-lg overflow-hidden">
            <Image
              src={imagePreview}
              alt="Preview"
              fill
              className="object-contain"
              unoptimized
            />
            <button
              type="button"
              onClick={removeImage}
              className="absolute top-2 right-2 p-1 bg-background/80 rounded-full hover:bg-background transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <label
            className="flex flex-col items-center justify-center w-full max-w-md aspect-square border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-muted-foreground transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleImageDrop}
          >
            <Upload className="h-8 w-8 text-muted-foreground mb-2" />
            <span className="text-sm text-muted-foreground">
              Drop an image or click to upload
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />
          </label>
        )}
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter concept title"
          required
        />
      </div>

      {/* Caption */}
      <div className="space-y-2">
        <Label htmlFor="caption">Caption</Label>
        <textarea
          id="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Enter caption or description"
          rows={3}
          className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <Input
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Uber, Duolingo, Spotify"
          list="categories"
        />
        <datalist id="categories">
          {categories.map((cat) => (
            <option key={cat} value={cat} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          The app or product being satirized
        </p>
      </div>

      {/* Date Posted */}
      <div className="space-y-2">
        <Label htmlFor="date_posted">Date Posted</Label>
        <Input
          id="date_posted"
          type="date"
          value={datePosted}
          onChange={(e) => setDatePosted(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Original post date (for sorting)
        </p>
      </div>

      {/* Published */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_published"
          checked={isPublished}
          onChange={(e) => setIsPublished(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <Label htmlFor="is_published" className="font-normal">
          Publish immediately
        </Label>
      </div>

      {/* Slug */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="slug">URL Slug</Label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={useCustomSlug}
              onChange={(e) => {
                setUseCustomSlug(e.target.checked)
                if (!e.target.checked) {
                  setSlug(autoSlug)
                }
              }}
              className="h-3 w-3 rounded border-border"
            />
            <span className="text-muted-foreground">Custom slug</span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">/c/</span>
          <Input
            id="slug"
            value={effectiveSlug}
            onChange={(e) => {
              setUseCustomSlug(true)
              setSlug(e.target.value)
            }}
            placeholder="category/concept-name"
            className="font-mono text-sm"
            disabled={!useCustomSlug}
          />
        </div>
        {useCustomSlug && effectiveSlug !== autoSlug && (
          <p className="text-xs text-muted-foreground">
            Auto-generated would be: <span className="font-mono">{autoSlug}</span>
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-border">
        <Button type="submit" disabled={saving || uploading}>
          {uploading ? 'Uploading...' : saving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/admin')}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
