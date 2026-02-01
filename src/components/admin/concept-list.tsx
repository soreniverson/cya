'use client'

import { useState } from 'react'
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
import { Pencil, Trash2, Eye, EyeOff } from 'lucide-react'
import type { Concept } from '@/lib/types'

interface AdminConceptListProps {
  concepts: Concept[]
}

export function AdminConceptList({ concepts }: AdminConceptListProps) {
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<Concept | null>(null)
  const [deleting, setDeleting] = useState(false)

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
              <th className="px-4 py-3 font-medium">Image</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Date Posted</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {concepts.map((concept) => (
              <tr key={concept.id} className="hover:bg-secondary/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="relative w-12 h-12 bg-[#111] rounded overflow-hidden">
                    <Image
                      src={concept.image_url}
                      alt={concept.title}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-sm">{concept.title}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {concept.slug}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {concept.category && (
                    <Badge variant="secondary">{concept.category}</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {concept.date_posted
                    ? new Date(concept.date_posted).toLocaleDateString()
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={concept.is_published ? 'default' : 'secondary'}>
                    {concept.is_published ? 'Published' : 'Draft'}
                  </Badge>
                </td>
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
                      <Button variant="ghost" size="sm">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(concept)}
                      className="text-destructive hover:text-destructive"
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
