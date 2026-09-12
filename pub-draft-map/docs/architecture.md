# Architecture

## Stack

- **Next.js 16 (App Router)**, TypeScript, Tailwind v4. Server components read the database directly; client components call JSON route handlers under `/api`.
- **Prisma 6** on Postgres (docker compose locally, Neon or similar hosted).
- **Leaflet + react-leaflet** with OpenStreetMap tiles. Loaded client-only via `next/dynamic`.
- **Zod** for request validation.

## Layout

```
prisma/schema.prisma        data model (see docs/data-model.md)
prisma/seed.ts              demo pubs in Manchester + Richmond, beer catalogue
scripts/import-osm.ts       Overpass importer (bbox / city / whole UK)
src/lib/db.ts               Prisma singleton
src/lib/auth.ts             cookie session (replace with Auth.js at launch)
src/lib/geo.ts              haversine, bbox, gazetteer, Nominatim
src/lib/beers.ts            beer matching incl. typo tolerance
src/lib/plans.ts            plan limits (client-safe)
src/lib/pub-owner.ts        owner authorisation
src/app/api/**              route handlers
src/app/page.tsx            map + search
src/app/pub/[id]            pub page: taps, ratings, photos, events, deals
src/app/beer/[id]           where a beer is on draft
src/app/for-pubs            landing + plans; [pubId] dashboard
src/components/*            MapExplorer, PubMap, TapList, AddTapForm, PubDashboard, AdSlot, Nav
```

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/pubs?bbox=s,w,n,e[&beer=]` | – | Pubs in viewport (max 2°×3°) |
| GET | `/api/pubs/:id` | – | Pub with active taps, ratings, photos, events, deals |
| POST | `/api/pubs/:id/taps` | user | Add/confirm a beer on draft |
| PATCH | `/api/taps/:id` | user | `confirm` or `remove` |
| POST | `/api/taps/:id/ratings` | user | Rate the beer here, 1–5 |
| POST | `/api/taps/:id/photos` | user | Multipart photo upload |
| POST | `/api/photos/:id/ratings` | user | Rate the pour, 1–5 |
| GET | `/api/search?beer=&near=` or `&lat=&lng=` | – | Ranked pubs pouring a beer; logs the search |
| GET | `/api/beers?q=` | – | Typeahead |
| GET/POST/DELETE | `/api/auth` | – | Session |
| POST | `/api/pubs/:id/claim` | user | Claim ownership |
| POST | `/api/pubs/:id/events` | owner | Plan-gated |
| POST | `/api/pubs/:id/deals` | owner | Plan-gated |
| POST | `/api/pubs/:id/subscription` | owner | Demo plan switch (Stripe later) |
| GET | `/api/insights/demand?place=&days=` | owner/admin | Aggregated demand |

Errors are `{ error, code? }`. 401 needs sign-in, 402 plan limit, 403 not the owner, 422 validation.

## Going to production

1. **PostGIS.** Add a generated `geography(Point)` column on `Pub` with a GiST index and replace the bbox-then-haversine filter in `/api/search` with `ST_DWithin`. Keep `lat`/`lng` columns for the client.
2. **pg_trgm** on `Beer.name` and `Brewery.name`; replace `fuzzyBeers()` with `similarity()` ordering.
3. **Auth.js** with email magic link + Google/Apple. `getCurrentUser()` is the only seam.
4. **Object storage** (R2/S3) for photos: swap `store()` in the photos route; keep `Photo.url` absolute. Add an image-resize step and a moderation queue.
5. **Rate limiting** on writes and on `/api/search` (Upstash or a Postgres token bucket); the search endpoint also feeds the demand data, so bot traffic must be filtered before it counts.
6. **Cron**: nightly OSM delta import, listing decay (hide after 30 days unconfirmed), demand aggregates rolled into a `DemandWeekly(beerId, postcodeDistrict, week, searches, unfulfilled, posts)` table so reports never scan `SearchLog`.
7. **Stripe** checkout + webhook (docs/monetisation.md).
8. **PWA** manifest + service worker; the contributor is on a phone.

## Why not X

- **Mapbox/Google Maps SDK**: cost at scale and licence constraints on caching venue data. OSM tiles are fine to start; move to a paid OSM tile host (MapTiler, Stadia) before real traffic, since the public tile server's usage policy forbids heavy apps.
- **Separate mobile app**: not until the web loop is proven. PWA gets camera and location.
- **Microservices**: one Next.js app and one Postgres will carry this past a million monthly users.
