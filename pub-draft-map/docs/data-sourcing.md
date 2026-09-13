# Getting every pub in the UK, and what's on their taps

Two separate problems. The first is solved; the second is the whole business.

## 1. Every pub and bar (venues)

**Primary: OpenStreetMap.** `amenity=pub|bar|biergarten` plus `craft=brewery` taprooms. Roughly 45,000 venues in the UK with name and coordinates, most with address. Licence is ODbL: free, must attribute, and any *derived database of venues* we publish must be shared alike. Our tap lists, ratings and photos are a separate collection, not a derivative, so they stay ours.

- `scripts/import-osm.ts` pulls a bbox, a city, or the whole UK (tiled, resumable) through the Overpass API.
- Re-run weekly; upserts by OSM id so renames and closures propagate.

**Enrichment (later):**
- **Food Standards Agency FHRS** open data: every licensed food premises with address and rating, including pubs. Good for postcode fill-in and for spotting pubs OSM lacks. Open Government Licence.
- **Companies House** for verifying claims by pub companies.
- **CAMRA WhatPub** has the best UK pub dataset but no public licence. Partnership conversation, not scraping.
- **Google Places** for photos/hours only if budget allows; its terms forbid storing most fields, so it can't be the base layer.

## 2. What's on draft (the hard part)

Nobody has this for the UK. There is no feed. It's built in layers, cheapest first:

### Layer A: crowd-sourcing (day one)
Drinkers add, confirm and flag. This is the model that built Untappd's venue data and OSM itself. What makes it work:
- **Zero-friction writes.** One tap to confirm, one to flag, camera-first photo upload. Signed-in state persists for 30 days.
- **Freshness signals shown, not hidden.** "Seen 3d ago · 4 confirms" sets expectations and prompts corrections.
- **Seeding target cities.** Pay a handful of people to walk a city's pubs over a weekend and log every tap. ~£1,500 covers central Manchester. Coverage from zero to 60% turns the loop on.
- **Gamification later, not first.** Badges are cheap; do them once there's a community to reward.

### Layer B: pubs self-report (month 2+)
Claimed pubs keep their own list. Most pubs already maintain a tap list somewhere: a chalkboard, an Untappd for Business page, an Instagram story. Give them the lowest-effort way in:
- Web dashboard (built).
- **Photograph the chalkboard** → OCR → suggested listings the pub confirms. Cheap to build with any vision model, and what landlords will actually do.
- WhatsApp/SMS "TAPS: Asahi, Neck Oil, Guinness" parser.

### Layer C: structured feeds (month 6+)
- **Untappd for Business** publishes public menu pages for subscribed venues; a partnership or their API gives thousands of UK craft venues at once.
- **Brewery tap-finders.** Big brands publish "where to find us" (Asahi, BrewDog, Camden). Import per brand; each one is a sponsorship conversation too.
- **EPOS / cellar systems** (Zonal, Vianet's iDraught, Star Stock, Tenzo). Vianet alone monitors flow on tens of thousands of UK taps. This is the eventual ground truth and the most valuable partnership in the plan, but it needs a track record first.

### Layer D: inference (built: `npm run enrich`)
Drinkers won't seed 50,000 tap lists, so the app ships with a *likely* list for every pub and lets people confirm or correct it. Two inputs:

1. **OSM tags.** `brand=*` and `operator=*` name the chain or pub company for tens of thousands of UK pubs (every Wetherspoon, Greene King, Fuller's, Toby, Harvester…). A smaller set carry `brewery=*`, which lists the beers actually served. `image=*` / `wikimedia_commons=*` give a licensed exterior photo.
2. **Brand ranges** (`data/brand-ranges.json`): the core draught range each chain or tied brewery puts in nearly every site. 79 ranges, 157 beers, curated from public menus and trade press; treat it as a living file. Pubs with no signal get the national default (Guinness, 50%).

`scripts/enrich-taps.ts` pulls the tags, stores brand/operator/photo on the pub, and upserts `TapListing` rows with `source=inferred|osm` and a `confidence`. The UI shows these under **Likely on tap**, search labels them *likely* and ranks confirmed sightings above them, and one tap of "Yes, it's on" promotes a listing to confirmed. Inferred rows are never allowed to overwrite a human one, and are withdrawn automatically if the pub's operator changes.

Expected coverage from the OSM tags alone: roughly a third of UK pubs get a chain or brewery range; the rest get the national default until a person or a partner feed fills them in.

### What we deliberately don't scrape
- **Google Maps / Google Business photos and menus.** Terms forbid storing them, and Google enforces. Photos come from Wikimedia Commons and Geograph (CC licences) and from users.
- **Untappd venue menus, Instagram, TikTok.** Same problem, and Untappd is the partner we most want. Ask for the feed instead.
- **CAMRA WhatPub.** Best real-ale data in the country, no licence to copy it. Partnership conversation.

### Scraping we can do, per site, with care
Pub-company websites publish per-pub drinks menus (Wetherspoon, Greene King, Marston's, Fuller's, Young's, Stonegate brands). Facts about what a pub sells aren't copyrightable, but each site has terms and a `robots.txt`; the plan is one importer per group that honours robots, identifies itself, fetches slowly, and stores only beer names and prices. Do these after the launch city is live and after asking the groups for a feed first, because a feed is cheaper for everyone and a scraper is a relationship you can't unburn.

## Trust model
Every listing has a source and a timestamp. Rank sources: EPOS > pub owner > multiple recent drinkers > single drinker > inferred. Conflicts resolve to the higher source; a drinker flag on an owner listing raises a notification to the owner rather than removing it outright.

## What to ignore
- Scraping Google Maps reviews or Untappd check-ins: against terms, legally exposed, and poisons any later partnership.
- Buying "pub databases" from list brokers: stale on arrival and no tap data.
