# Launch plan: Thursday 17 September 2026, evening

Goal: a public, working Draft Map by Thursday evening, so people find it over the weekend. This is the order of work from Monday afternoon, with what each step needs and how long it takes. Everything below already exists in the repo; the plan is about running it against real accounts and real data.

## What "launched" means on Thursday

- The site is live on a public URL and works on a phone.
- Every UK pub is on the map (about 49,000 from OpenStreetMap), with the closed and unresearched ones hidden per the evidence rule.
- Every visible pub has a tap list from the best evidence we have: its own site, a company site, or a chain range.
- Search by beer and by place works anywhere in the UK.
- A landlord can claim a pub and photograph the pumps.
- Attribution, privacy page and contact address are in place.

Not on Thursday: Stripe billing (demo mode is fine), ad revenue (placeholder slots), the second research pass over every pub in the country (it keeps running after launch).

## Monday (today): accounts and the base layer

1. **Accounts** (30 min): create a Neon Postgres project, a Vercel project pointed at this repo with root directory `pub-draft-map`, and set `DATABASE_URL`, `SESSION_SECRET`, `GEOCODER_USER_AGENT`, `IMPORT_USER_AGENT`. Get a Gemini API key on the free tier and, if you have one, a Brave Search key. Put them in a local `.env`.
2. **Deploy once** so the migrations run and the empty site is reachable (10 min).
3. **Base layer** from your machine against the Neon database (about 1 hour, resumable):
   ```bash
   npm run import:osm -- --uk
   npm run enrich
   ```
4. **Company lists** (2 to 3 hours in the background):
   ```bash
   npm run import:menus -- --site wetherspoon
   npm run import:menus -- --site greeneking
   npm run import:menus -- --site allbarone
   ```
   Check Wetherspoon with `--limit 3 --dry` first; its menu host was unreachable from the build sandbox and the parser is written defensively.
5. **Packets** overnight: `npm run research:packets -- --all --shards 300`. This crawls the 14,500 pubs whose website we already know, politely, and takes most of the night.

## Tuesday: research at scale

1. **Start the workers.** Areas with known websites first, no searches needed:
   ```bash
   for a in $(seq -w 1 300); do npm run research:worker -- --shard area-$a --search none --read gemini; done
   ```
   Run several in parallel from separate terminals; each exits with code 3 when the day's allowance is spent and resumes tomorrow.
2. **Searches** for the rest, spread over sources: Gemini grounding for some areas, Brave for others, and Claude Code sessions with `scripts/research/WORKER.md` for a couple of areas each. About 35,000 pubs have no known website; do not expect to finish these by Thursday. Prioritise the launch region and big cities: London, Manchester, Birmingham, Leeds, Bristol, Glasgow, Edinburgh.
3. **Import** as results land: `npm run research:apply`. Repeatable.
4. **Photos**: `npm run import:photos` for a licensed exterior photo on a third to a half of pubs.

## Wednesday: quality and the app

1. **Spot-check** twenty `site_menu` pubs against their URLs, and twenty hidden ones. Add anything junk to the junk list and re-run the import.
2. **Decide the hidden rule for open pubs with nothing published.** The current rule hides them. If the map looks empty in rural areas, the alternative is to show them with the chain or national default and no list, which keeps the location useful. It is one line in `research/apply.ts`.
3. **Pages**: check `/about` (attribution to OpenStreetMap, Wikimedia Commons and Geograph), add a short privacy notice and a contact email. Confirm the pub page, beer page and search all work on a phone against the live database.
4. **Claim flow**: claim a pub yourself on the live site, photograph a board with your phone, publish it. Needs `ANTHROPIC_API_KEY` on Vercel for the board reader; without it the claim and manual list still work.
5. **Redeploy** with any fixes.

## Thursday: launch day

1. Morning: final `research:apply`, final spot-check, redeploy.
2. Afternoon: write the launch post. Lead with the search ("find Guinness near you", "what's on in Richmond tonight") and the landlord offer ("claim your pub free, photograph your pumps, you are listed by tonight").
3. Evening: post it. Watch `/api/insights/demand` and the search log for what people look for; that becomes Friday's research priority list.

## After launch

- Keep the workers running area by area until every pub has been through the algorithm once; re-run areas every quarter.
- Landlord outreach: every pub with an email on its site gets one message with its claim link.
- Ask Greene King, Stonegate and Mitchells & Butlers for a drinks feed, with the adapters as the argument that we already show what they publish.

## Risks

| Risk | Plan |
|---|---|
| Free-tier allowances smaller than expected | Workers resume tomorrow; launch with whatever coverage exists, the map is still complete. |
| OSM import slower than an hour on a home connection | Start it Monday afternoon; it is resumable. |
| Vercel build time on migrations | `build:deploy` runs migrations first; if it times out, run `npm run db:deploy` locally against Neon before deploying. |
| Photo uploads on Vercel are ephemeral | Known; board photos are read and discarded, and the list is what persists. Object storage is a post-launch item. |
