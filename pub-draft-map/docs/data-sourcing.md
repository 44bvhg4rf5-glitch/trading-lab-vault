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

### Pub-company websites (built: `npm run import:menus -- --site <key>`)
Facts about what a pub sells aren't copyrightable, but every site has terms and a `robots.txt`. `scripts/importers/lib.ts` is the shared plumbing: identifies itself with a contact address, checks robots.txt before every host, one request at a time with a delay, disk cache, and it stores only beer names and prices. `scripts/import-menus.ts` matches each site record to our pub by postcode + name (then name + distance) and writes listings with `source=site:<key>` at confidence 0.95, retiring inferred rows the site doesn't list. A human confirmation still wins.

What the reconnaissance found (September 2026), so nobody repeats it:

| Group | Pubs | Status |
|---|---|---|
| **Wetherspoon** | 827 | Adapter built. Sitemap + pub pages give identity (name, postcode, coordinates) and the venue id: verified. The drinks list is served by the app's menu API, whose host was blocked from the build sandbox, so `parseMenu` is written schema-tolerant and must be checked with `--limit 3 --dry` on a normal connection. Their public PDF is the food menu only. |
| **Greene King** | ~2,700 | Sitecore JSS site. Pub finder and pages render client-side; `/api/cards` is allowed by robots but returned 500. Needs a session with the site open in a browser to find the layout-service call. |
| **Marston's** | ~1,300 | Consumer pub finder at marstonspubs.co.uk/pubs/finder/ is client-rendered; sitemap is corporate only. Same next step as Greene King. |
| **Fuller's** | ~380 | Cloudflare bot challenge on every page. Do not fight it: ask for a feed. |
| **Young's** | ~230 | No central pub pages; each pub has its own site. Ask for a feed. |
| **Stonegate brands** (Slug & Lettuce, Yates, Be At One…) | ~4,500 | robots allow; sitemaps are per-brand and content is client-rendered. Same next step as Greene King. |
| **Mitchells & Butlers brands** (Nicholson's, All Bar One, Harvester, Toby…) | ~1,700 | robots allow `/national-search/*`; venue pages redirect. Same next step. |

Do the client-rendered sites once the launch city is live, and ask each group for a feed first: a feed is cheaper for everyone and a scraper is a relationship you can't unburn.

### Per-pub research and delisting (built: `npm run research`)
The product rule is: we hold the data, drinkers don't enter it, and a pub we can't find anything for comes off the map. `scripts/research-pubs.ts` runs that rule over every pub:

1. **Website.** OSM has one for 14,557 pubs. For the rest, an optional Brave Search lookup (`BRAVE_SEARCH_API_KEY`) finds the pub's own site and discards social, aggregator and booking pages.
2. **Crawl.** Up to six pages per site, drinks and beer links first, feeds and blogs skipped, robots.txt honoured, plus any drinks PDF and any image the page labels as a menu, board, taps or pumps.
3. **Extract.** Whole-word matching against `data/beer-catalogue.json` (about 450 UK draught beers and ciders with brewery and ABV) and "<Name> 4.5%" patterns, which need no API key. With `ANTHROPIC_API_KEY` set, every drinks page, PDF and board image is also read by Claude, which is what catches guest ales and local breweries the catalogue can't.
4. **Decide.** `Pub.evidence` is set to `site_menu`, `company`, `chain`, `people` or `none`, and `none` sets `hidden=true`, which removes the pub from the map, search and its page. Nothing is deleted, so a later source can bring it back.

What the first test run on eight real sites showed: sites that list their beers in text work (Amstel, Boddingtons picked up with ABVs); craft bars mostly embed their Untappd menu, which is a partner feed and not scrapable, and the pipeline records that as a lead; country pubs mostly say "a large selection of beers" and nothing more, so without a board photo they are correctly `none`.

Not done, on purpose: Instagram, Facebook, Google reviews and Untappd. Their terms forbid automated access, they block it aggressively, and Meta litigates. A scraper there would get the project banned before it produced a usable list.

### Photos (built: `npm run import:photos`)
Wikimedia Commons hosts Commons' own uploads plus ~1.2 million Geograph photos of Britain (CC BY-SA 2.0), and most pubs have been photographed. `scripts/import-photos.ts` geosearches 150 m around each pub and only accepts a file whose title contains a distinctive word from the pub's name, so it never attaches the neighbour's house. Tested on a sample: no false matches; roughly a third to a half of pubs get a photo. The stored credit string satisfies the licence; show it next to the image.

### Board photos (built: pub dashboard and "Report a change")
`src/lib/board-ocr.ts` sends a photo of pump clips, a chalkboard or a printed drinks menu to Claude and gets back a structured list (name, brewery, ABV, price, serving, confidence). The pub owner or drinker ticks what's right and publishes; an owner's publish is `source=pub_owner`, a drinker's is `source=user`, and "this shows the whole board" retires everything else. Needs `ANTHROPIC_API_KEY` on the server. This is the route to the independent and craft bars no chain range or company site will ever cover.

## Trust model
Every listing has a source and a timestamp. Rank sources: EPOS > pub owner > multiple recent drinkers > single drinker > inferred. Conflicts resolve to the higher source; a drinker flag on an owner listing raises a notification to the owner rather than removing it outright.

## What to ignore
- Scraping Google Maps reviews or Untappd check-ins: against terms, legally exposed, and poisons any later partnership.
- Buying "pub databases" from list brokers: stale on arrival and no tap data.
