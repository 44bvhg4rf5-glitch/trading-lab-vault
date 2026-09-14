# 🍺 Draft Map

What's on draft at every pub and bar in the UK. Search a beer near a place, see who pours it, how good it is there, and what the pour looks like. Pubs claim their listing to keep it right and to post events and deals.

## Run it locally

Needs Node 20+ and Postgres. Docker is the quickest Postgres:

```bash
cp .env.example .env
docker compose up -d   # Postgres on localhost:5432
npm install            # also runs prisma generate
npm run db:deploy      # creates the tables
npm run db:seed        # 14 real pubs in Manchester + Richmond, 16 beers
npm run dev            # http://localhost:3000
```

No Docker? Create a free database at neon.tech or supabase.com and paste its connection string into `DATABASE_URL`.

## Put it online (works from a phone)

1. Create a free Postgres at [neon.tech](https://neon.tech) and copy the connection string.
2. Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, import this repository.
3. Set **Root Directory** to `pub-draft-map` and the branch to `claude/pub-beer-draft-map-6b4dmz`.
4. Add environment variables `DATABASE_URL` (from step 1) and `SESSION_SECRET` (any long random string).
5. Deploy. The build runs the migrations (`vercel.json` sets the build command), so the app comes up with empty tables.
6. Seed it once from any machine with the same `DATABASE_URL` in `.env`: `npm run db:seed`, and optionally `npm run import:osm -- --city manchester`.

Photo uploads write to the local filesystem, which does not persist on Vercel. Switch `store()` in the photos route to object storage before relying on them (see docs/architecture.md).

Try: search **asahi** near **Manchester**, or open `/?beer=ashai&near=Richmond` (typo intended).

Demo accounts (any email works; these are pre-seeded):
- `landlord@draftmap.local` owns The White Cross (Richmond) on the Promoted plan: open `/for-pubs`.
- `demo@draftmap.local` is a drinker with ratings.

## Fill the tap lists

```bash
npm run enrich                                 # chain ranges + OSM brewery tags, every pub
npm run import:menus -- --site wetherspoon     # 827 pubs from Wetherspoon's own site
npm run import:menus -- --site greeneking      # 753 managed pubs, cask list per pub
npm run import:menus -- --site allbarone       # Mitchells & Butlers brands: only "On Tap" sections
npm run import:photos                          # Commons/Geograph photos
```

Board photos: set `ANTHROPIC_API_KEY` in `.env` and pub owners (dashboard) or drinkers ("Report a change") can photograph the pumps or chalkboard; the list is read, ticked and published in one go.

### Research every pub, for free, with a group of AI workers

`npm run research` finds and reads each pub's website with plain text matching and hides pubs it finds nothing for. The reading that would otherwise need a paid API key can be done by AI workers in a Claude Code session instead, one per area:

```bash
npm run research:packets -- --all --shards 300      # one packet per pub, 300 geographic areas
npm run research:worker -- --shard area-001 --search gemini --read gemini   # unattended, any provider's free tier
# or start a Claude Code subagent per area with scripts/research/WORKER.md as its brief
npm run research:apply                              # write what the workers found, retire junk names
```

Every worker follows [docs/research-algorithm.md](docs/research-algorithm.md); `--search` takes `gemini`, `brave` or `none` and `--read` takes `gemini`, `openai`, `anthropic` or `none`. A worker exits with code 3 when a free allowance runs out and resumes from its results file on the next run.

Each worker gets `.cache/research/packets/<area>/index.json`, searches the web for the pub's own site where none is known, reads the drinks pages, PDFs and board photos the packet builder fetched politely, and writes a clean draught list to `.cache/research/results/<area>.json`.

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
| [docs/research-algorithm.md](docs/research-algorithm.md) | The one workflow every research worker follows, on any AI provider |
| [docs/launch-plan.md](docs/launch-plan.md) | Day-by-day runbook to the Thursday evening launch |
| [docs/roadmap.md](docs/roadmap.md) | Next 6 months |

## Scripts

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint |
| `npm run db:deploy` | Apply migrations |
| `npm run db:migrate` | Create a new migration after schema changes |
| `npm run db:seed` | Seed demo data |
| `npm run build:deploy` | Migrate then build (used by Vercel) |
| `npm run import:osm` | Overpass importer |
| `npm run enrich` | Pre-fill tap lists from chain ranges and OSM tags |
| `npm run import:menus -- --site wetherspoon` | Drinks menus from a pub company's own site |
| `npm run import:photos` | Licensed exterior photos from Wikimedia Commons |
| `npm run research` | Find and read each pub's own website; hide pubs with nothing |
| `npm run research:packets` / `research:apply` | Packets for AI research workers, and import of what they found |

## Status

Working MVP on Postgres with a demo sign-in and demo billing. See [docs/roadmap.md](docs/roadmap.md) for what stands between this and a public launch. Pub locations © OpenStreetMap contributors, ODbL.
