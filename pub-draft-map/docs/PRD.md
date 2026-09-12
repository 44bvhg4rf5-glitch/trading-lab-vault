# Draft Map — product requirements

## One line

Find any beer on draft near you, at every pub and bar in the UK, and see how good the pour is there.

## Who it's for

| Persona | Job to be done | What they do in the app |
|---|---|---|
| **The loyalist** ("I want an Asahi in Manchester") | Find a specific beer nearby, right now | Search beer + place, pick the closest well-rated pub |
| **The explorer** | See what's interesting on tap around here | Pan the map, open pubs, browse tap lists |
| **The contributor** | Be the person who knows what's on | Add beers to a tap list, confirm/flag, photograph the pour, rate |
| **The landlord** | Get people through the door | Claim the pub, keep the tap list right, post events and deals |
| **The buyer** (pub group, brewery, distributor) | Decide what to stock and where | Buy area-level demand reports |

## Core loop

1. Drinker searches a beer near a place (or "near me").
2. Results ranked by distance, with rating and price per match. Promoted pubs win ties.
3. Drinker goes, drinks, and either **confirms** the listing ("still on"), **flags** it ("gone"), **rates** the beer at that pub, or **posts a photo** of the pour, which others rate.
4. Every action refreshes `lastSeenAt` and confirmation counts, so the freshest tap lists float up and stale ones decay.
5. Searches and posts are aggregated by area into the demand product; pubs use it to choose stock; buyers pay for it.

## Functional requirements

### Map & discovery
- Map of all pubs/bars in the current viewport (OSM-derived), with active tap counts.
- Beer search with typo tolerance ("ashai" → Asahi) and brewery matching ("cloudwater").
- Place search via built-in gazetteer of UK cities/neighbourhoods, then Nominatim geocoder; "near me" via browser geolocation.
- Deep-linkable searches: `/?beer=asahi&near=Richmond`.
- Beer page: everywhere a beer is on draft, grouped by city.

### Tap lists (crowd-sourced, with pub override)
- Anyone signed in can add a beer to a pub's tap list, with optional price and serving size.
- Listings carry `lastSeenAt`, `confirmations`, and can be confirmed or removed by any user.
- A claimed pub's owner can manage the list directly (same endpoints, elevated trust; UI in the dashboard is the next step).
- Decay rule (to implement as a cron): listings not confirmed in 30 days are hidden from search but kept for history.

### Ratings & photos
- Beer rating 1–5 per (user, tap listing): "how good is *this beer here*", not the beer in general. Aggregates roll up to the beer page.
- Photo upload per tap listing (POUR / BEER / VENUE). Others rate the pour 1–5.
- Moderation queue for photos is required before public launch (report button + admin review).

### Accounts
- MVP: email + display name, signed cookie session. Launch: magic link or OAuth via Auth.js.
- Roles: DRINKER, PUB_OWNER, ADMIN.

### Pub accounts
- Claim a pub from its page. MVP is instant; launch requires verification (call to the listed phone number, or a code posted to the address).
- Plans (see `docs/monetisation.md`): FREE / LISTED (£19) / PROMOTED (£49).
- Post events (title, time, description) and deals (title, validity). Gated by plan.
- Dashboard shows area demand: most searched and most photographed beers in the pub's city over 30 days.

### Data product
- `/api/insights/demand` returns aggregated counts only. No row-level user data leaves the system, ever.

## Non-functional
- Mobile first: the contributor is standing at a bar with one hand free. Every write action is one or two taps.
- p95 search under 300 ms with 50k pubs and 500k listings (needs PostGIS + pg_trgm on top of the current Postgres schema).
- OSM attribution on every map and on the About page (ODbL requirement).
- UK GDPR: aggregate-only analytics, deletable accounts, no sale of individual data.

## Out of scope for v1
- Bottles/cans, food menus, opening hours (OSM has hours; can be surfaced later).
- Social graph, follows, feeds.
- Native apps. The web app is installable as a PWA first.
- Real-time POS integrations (see `docs/data-sourcing.md` for why that's phase 3).

## Success metrics
- Coverage: % of pubs in a city with at least one active listing (target 40% in launch cities within 3 months).
- Freshness: median `lastSeenAt` age of listings shown in search (target under 14 days).
- Contribution rate: writes per search session (target 5%).
- Pub conversion: claimed pubs → paid plan (target 10%).
