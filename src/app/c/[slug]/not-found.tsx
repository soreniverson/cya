import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-medium">Concept not found</h1>
        <p className="text-muted-foreground">
          The concept you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>
        <Link
          href="/"
          className="inline-block text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          Back to archive
        </Link>
      </div>
    </main>
  )
}
