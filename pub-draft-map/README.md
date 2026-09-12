# 🍺 Draft Map

What's on draft at every pub and bar in the UK. Search a beer near a place, see who pours it, how good it is there, and what the pour looks like. Pubs claim their listing to keep it right and to post events and deals.

## Run it

```bash
cp .env.example .env
npm install            # also runs prisma generate
npx prisma migrate dev # creates prisma/dev.db (SQLite)
npm run db:seed        # 14 real pubs in Manchester + Richmond, 16 beers
npm run dev            # http://localhost:3000
```

Try: search **asahi** near **Manchester**, or open `/?beer=ashai&near=Richmond` (typo intended).

Demo accounts (any email works; these are pre-seeded):
- `landlord@draftmap.local` owns The White Cross (Richmond) on the Promoted plan: open `/for-pubs`.
- `demo@draftmap.local` is a drinker with ratings.

## Import real pubs from OpenStreetMap

```bash
npm run import:osm -- --city manchester --radius 15
npm run import:osm -- --bbox 51.40,-0.40,51.50,-0.20     # SW London
npm run import:osm -- --uk                                # everything, ~1h, resumable
```

## Docs

| | |
|---|---|
| [docs/PRD.md](docs/PRD.md) | What we're building and for whom |
| [docs/data-sourcing.md](docs/data-sourcing.md) | How to get every pub, and every tap list |
| [docs/monetisation.md](docs/monetisation.md) | Ads, pub plans, demand data |
| [docs/architecture.md](docs/architecture.md) | Stack, API, path to production |
| [docs/data-model.md](docs/data-model.md) | Schema decisions |
| [docs/roadmap.md](docs/roadmap.md) | Next 6 months |

## Scripts

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Prisma migrate dev |
| `npm run db:seed` | Seed demo data |
| `npm run import:osm` | Overpass importer |

## Status

Working MVP on SQLite with a demo sign-in and demo billing. See [docs/roadmap.md](docs/roadmap.md) for what stands between this and a public launch. Pub locations © OpenStreetMap contributors, ODbL.
