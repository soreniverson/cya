# Can You Imagine

A public archive of satirical interface concepts by Soren Iverson, presented as an
infinite pan-and-zoom canvas. Live at [www.canyouimagine.lol](https://www.canyouimagine.lol).

Next.js 16 (App Router) · PixiJS 8 for the canvas · Supabase for Postgres, auth and
image storage · deployed on Vercel.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev
```

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public key. Ships to the browser — it must never be the service role key. |
| `NEXT_PUBLIC_SITE_URL` | yes in prod | Canonical origin, e.g. `https://www.canyouimagine.lol`. Drives `robots.txt`, the sitemap and every canonical/OG URL. **No trailing newline or slash.** |
| `SUPABASE_SERVICE_ROLE_KEY` | scripts only | Bypasses RLS. Only ever used by `scripts/`, never by the app. |

## Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | ISR, 1h | The infinite canvas. Also emits a screen-reader/crawler-only index of every concept. |
| `/c/[...slug]` | dynamic | Concept detail. Catch-all because slugs are `category/title`, i.e. two path segments. |
| `/directory` | ISR, 60s | Searchable, paginated grid — the accessible counterpart to the canvas. |
| `/admin` | dynamic, auth | Create, edit, publish and delete concepts. |
| `/api/concepts` | dynamic | Paginated JSON for the directory's infinite scroll. |

## Data model

One table, `concepts`. Three image tiers per concept, and the display order matters:

- `thumbnail_url` — 150px JPEG, used by the canvas when zoomed out and by directory cards.
- `mid_url` — 800px JPEG, used by the canvas when zoomed in, the lightbox, and detail pages.
- `image_url` — the original upload. A fallback only; **never** rendered when the other two exist.

Because every surface prefers the derived tiers, anything that writes `image_url`
must write `thumbnail_url` and `mid_url` in the same statement or the change will
not appear anywhere. The admin form does this; so does `scripts/generate-thumbnails.ts`.

`search_vector` is a generated tsvector backing `/directory`'s full-text search.
Public queries select explicit columns rather than `*` so it never reaches the browser.

## Security model

- RLS is on. Anonymous users can read published concepts and read images. Nothing else.
- Write access is scoped to a single owner UID, not to the `authenticated` role —
  otherwise any self-registered user would have full control of the archive.
- **Keep signup disabled** in the Supabase dashboard (Authentication → Providers → Email).
- `.claude/settings.local.json` is gitignored because it can pick up credentials.
  Never commit a service role key; this repo is public.

## Scripts

Each needs `SUPABASE_SERVICE_ROLE_KEY` in the environment.

```bash
npm run batch-upload                     # bulk import concepts
npx tsx scripts/generate-thumbnails.ts   # backfill thumbnail_url / mid_url
npx tsx scripts/check-urls.ts            # find concepts pointing at missing objects
npx tsx scripts/cleanup-storage.ts       # remove orphaned storage objects
```

## Checks

`npm run build` runs ESLint first and fails on any error or warning, so lint problems
cannot reach production unnoticed.

```bash
npm run lint
npx tsc --noEmit
npm run build
```
