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
  const [datePosted, setDatePosted] = useState(concept?.date_posted ?? '')
  const [isPublished, setIsPublished] = useState(concept?.is_published ?? true)
  const [imageUrl, setImageUrl] = useState(concept?.image_url ?? '')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(concept?.image_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const uploadImage = async (file: File): Promise<string> => {
    const supabase = createClient()
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`

    const { error } = await supabase.storage
      .from('concepts')
      .upload(fileName, file, {
        cacheControl: '31536000',
        upsert: false,
      })

    if (error) throw error

    const { data: { publicUrl } } = supabase.storage
      .from('concepts')
      .getPublicUrl(fileName)

    return publicUrl
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
      let finalImageUrl = imageUrl

      // Upload new image if selected
      if (imageFile) {
        setUploading(true)
        finalImageUrl = await uploadImage(imageFile)
        setUploading(false)
      }

      // Generate slug
      const slug = generateSlug(category, title)

      const conceptData = {
        title: title.trim(),
        caption: caption.trim() || null,
        category: category.trim() || null,
        date_posted: datePosted || null,
        is_published: isPublished,
        image_url: finalImageUrl,
        slug,
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

      {/* Slug Preview */}
      {title && (
        <div className="p-3 bg-secondary rounded-md">
          <p className="text-xs text-muted-foreground mb-1">URL Preview</p>
          <p className="text-sm font-mono">
            /c/{generateSlug(category, title)}
          </p>
        </div>
      )}

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
