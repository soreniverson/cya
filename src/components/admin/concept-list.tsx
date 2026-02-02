'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Pencil, Trash2, Eye, EyeOff, Check, X } from 'lucide-react'
import type { Concept } from '@/lib/types'

interface AdminConceptListProps {
  concepts: Concept[]
  categories: string[]
}

type EditableField = 'title' | 'category' | 'caption'

interface EditingState {
  id: string
  field: EditableField
  value: string
}

export function AdminConceptList({ concepts, categories }: AdminConceptListProps) {
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<Concept | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select()
      }
    }
  }, [editing])

  const handleDelete = async () => {
    if (!deleteTarget) return

    setDeleting(true)
    const supabase = createClient()

    const { error } = await supabase
      .from('concepts')
      .delete()
      .eq('id', deleteTarget.id)

    if (error) {
      console.error('Error deleting concept:', error)
      setDeleting(false)
      return
    }

    setDeleteTarget(null)
    setDeleting(false)
    router.refresh()
  }

  const togglePublished = async (concept: Concept) => {
    const supabase = createClient()

    const { error } = await supabase
      .from('concepts')
      .update({ is_published: !concept.is_published })
      .eq('id', concept.id)

    if (error) {
      console.error('Error updating concept:', error)
      return
    }

    router.refresh()
  }

  const startEditing = (concept: Concept, field: EditableField) => {
    const value = field === 'title'
      ? concept.title
      : field === 'category'
        ? concept.category ?? ''
        : concept.caption ?? ''
    setEditing({ id: concept.id, field, value })
  }

  const cancelEditing = () => {
    setEditing(null)
  }

  const saveEdit = async () => {
    if (!editing) return

    setSaving(true)
    const supabase = createClient()

    const { error } = await supabase
      .from('concepts')
      .update({ [editing.field]: editing.value || null })
      .eq('id', editing.id)

    setSaving(false)

    if (error) {
      console.error('Error updating concept:', error)
      return
    }

    setEditing(null)
    router.refresh()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      saveEdit()
    } else if (e.key === 'Escape') {
      cancelEditing()
    }
  }

  if (concepts.length === 0) {
    return (
      <div className="text-center py-20 border border-dashed border-border rounded-lg">
        <p className="text-muted-foreground">No concepts yet</p>
        <Link href="/admin/new" className="text-sm text-foreground underline underline-offset-4 mt-2 inline-block">
          Create your first concept
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-secondary">
            <tr className="text-left text-sm text-muted-foreground">
              <th className="px-4 py-3 font-medium w-16">Image</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium w-32">Category</th>
              <th className="px-4 py-3 font-medium">Caption</th>
              <th className="px-4 py-3 font-medium w-28">Date</th>
              <th className="px-4 py-3 font-medium w-24">Status</th>
              <th className="px-4 py-3 font-medium text-right w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {concepts.map((concept) => (
              <tr key={concept.id} className="hover:bg-secondary/50 transition-colors">
                {/* Image with hover preview */}
                <td className="px-4 py-3">
                  <div className="group relative">
                    <div className="relative w-12 h-12 bg-[#111] rounded overflow-hidden">
                      <Image
                        src={concept.thumbnail_url || concept.image_url}
                        alt={concept.title}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    {/* Large preview on hover */}
                    <div className="absolute left-14 top-0 z-50 hidden group-hover:block">
                      <div className="relative w-64 h-64 bg-[#111] rounded-lg overflow-hidden shadow-2xl border border-border">
                        <Image
                          src={concept.mid_url || concept.image_url}
                          alt={concept.title}
                          fill
                          className="object-contain"
                          unoptimized
                        />
                      </div>
                    </div>
                  </div>
                </td>

                {/* Title - Editable */}
                <td className="px-4 py-3">
                  {editing?.id === concept.id && editing.field === 'title' ? (
                    <div className="flex items-center gap-1">
                      <input
                        ref={inputRef as React.RefObject<HTMLInputElement>}
                        type="text"
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onKeyDown={handleKeyDown}
                        onBlur={saveEdit}
                        className="w-full px-2 py-1 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-ring"
                        disabled={saving}
                      />
                    </div>
                  ) : (
                    <div
                      onClick={() => startEditing(concept, 'title')}
                      className="cursor-pointer hover:bg-secondary/80 px-2 py-1 -mx-2 rounded transition-colors"
                    >
                      <p className="font-medium text-sm">{concept.title}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {concept.slug}
                      </p>
                    </div>
                  )}
                </td>

                {/* Category - Editable */}
                <td className="px-4 py-3">
                  {editing?.id === concept.id && editing.field === 'category' ? (
                    <div className="flex items-center gap-1">
                      <input
                        ref={inputRef as React.RefObject<HTMLInputElement>}
                        type="text"
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onKeyDown={handleKeyDown}
                        onBlur={saveEdit}
                        list={`categories-${concept.id}`}
                        className="w-full px-2 py-1 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-ring"
                        disabled={saving}
                      />
                      <datalist id={`categories-${concept.id}`}>
                        {categories.map((cat) => (
                          <option key={cat} value={cat} />
                        ))}
                      </datalist>
                    </div>
                  ) : (
                    <div
                      onClick={() => startEditing(concept, 'category')}
                      className="cursor-pointer hover:bg-secondary/80 px-2 py-1 -mx-2 rounded transition-colors min-h-[28px]"
                    >
                      {concept.category ? (
                        <Badge variant="secondary">{concept.category}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  )}
                </td>

                {/* Caption - Editable */}
                <td className="px-4 py-3">
                  {editing?.id === concept.id && editing.field === 'caption' ? (
                    <div className="flex items-center gap-1">
                      <textarea
                        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onKeyDown={handleKeyDown}
                        onBlur={saveEdit}
                        rows={2}
                        className="w-full px-2 py-1 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                        disabled={saving}
                      />
                    </div>
                  ) : (
                    <div
                      onClick={() => startEditing(concept, 'caption')}
                      className="cursor-pointer hover:bg-secondary/80 px-2 py-1 -mx-2 rounded transition-colors min-h-[28px]"
                    >
                      {concept.caption ? (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {concept.caption}
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  )}
                </td>

                {/* Date */}
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {concept.date_posted
                    ? new Date(concept.date_posted).toLocaleDateString()
                    : '—'}
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <Badge variant={concept.is_published ? 'default' : 'secondary'}>
                    {concept.is_published ? 'Published' : 'Draft'}
                  </Badge>
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => togglePublished(concept)}
                      title={concept.is_published ? 'Unpublish' : 'Publish'}
                    >
                      {concept.is_published ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Link href={`/admin/edit/${concept.id}`}>
                      <Button variant="ghost" size="sm" title="Full edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(concept)}
                      className="text-destructive hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete concept</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.title}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
