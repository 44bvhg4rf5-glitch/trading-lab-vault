# Roadmap

## Now (this repo)
- [x] Map of pubs with viewport loading
- [x] Beer + place search with typo tolerance, deep links, "near me"
- [x] Pub page: tap list, add/confirm/remove, rate beer, photo upload, rate pour
- [x] Beer page: everywhere it's on draft
- [x] Accounts (demo), pub claim, plans, events, deals, plan gating
- [x] Demand insights endpoint + owner dashboard
- [x] Ad slots
- [x] OSM importer

## Next 4 weeks: launch-ready in one city
1. Auth.js magic link; delete the demo sign-in.
2. Postgres + PostGIS + pg_trgm; deploy (Vercel + Neon/Supabase, or Fly + managed Postgres).
3. Photo storage on R2 with resize; report button; admin moderation page.
4. Rate limiting; bot filtering on search logging.
5. Listing decay cron; nightly OSM import for the launch city.
6. PWA manifest, install prompt, camera-first upload polish on mobile.
7. Owner tap-list editing in the dashboard (bulk add, reorder, mark "permanent" vs "guest").
8. Claim verification: phone-call code to the OSM-listed number.
9. Privacy policy, terms, cookie notice, OSM attribution page. Register with the ICO.

## Launch: Manchester
- Seed ~300 central pubs by paid walk-through over one weekend.
- Recruit 20 claimed pubs on Free, 5 on Promoted (offer 3 months free).
- Target: 40% of central pubs with an active list, 1,000 weekly searches by week 6.

## Months 2–3
- Chalkboard OCR for pub self-reporting.
- Sponsored search sold to one brewery as a pilot.
- Stripe billing live; Listed/Promoted upsell inside the 402 flows.
- Second city (Richmond/SW London or Leeds, whichever has the more responsive pubs).

## Months 4–6
- Weekly demand aggregates table and the postcode-district report.
- Brand dashboard pilot with one distributor.
- Untappd for Business / brewery tap-finder imports.
- Pub-group enterprise plan (bulk claim, single dashboard).

## Later
- EPOS/flow-meter partnership (Vianet, Zonal) for ground-truth tap data.
- Native apps if PWA retention plateaus.
- Ireland, then wherever the beer is.
