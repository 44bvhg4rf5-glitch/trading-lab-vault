# Data model

Source of truth is `prisma/schema.prisma`. This is the map.

```
User ──< Session
User ──< TapListing (reportedBy)
User ──< BeerRating
User ──< Photo ──< PhotoRating >── User
User ──< Pub (claimedBy)

Pub ──< TapListing >── Beer >── Brewery
Pub ──< Event
Pub ──< Deal
Pub ──1 PubSubscription
Pub ──< SearchLog (optional: which pub the search led to)
Beer ──< SearchLog
```

## Key decisions

**TapListing is the centre.** Ratings and photos hang off the *listing* (this beer at this pub), not the beer. "Guinness here is a 5, Guinness over the road is a 2" is the whole point. Beer-level scores are rolled up from listings.

**Listings are never deleted.** `status` goes ACTIVE → REMOVED with `removedAt`. History is what makes "this pub had Jaipur last summer" and the demand product possible. Re-adding a removed beer flips it back to ACTIVE and bumps `confirmations`.

**One listing per (pub, beer).** Enforced by a unique index. Price and serving size live on the listing; a pub pouring the same beer in two formats is rare enough to ignore for v1.

**Freshness is data.** `firstSeenAt`, `lastSeenAt`, `confirmations`. Every confirm bumps both. Ranking and decay use these; the UI shows them.

**Pub identity comes from OSM.** `osmId` is the stable key for imports. Pubs added by users or owners have `osmId = null` and `source` set accordingly; a later reconciliation job can match them to OSM by name + distance.

**Money fields.** `pricePence` as integer. Never floats for money.

**SearchLog is append-only and aggregate-read.** `userId` is nullable and exists only so account deletion can scrub it. Reports read counts grouped by `beerId` and `place`; production adds a rolled-up weekly table.

**Roles are a string, plans are a string.** Allowed values are documented in the schema comments and enforced by Zod at the API boundary; they can become Postgres enums in one migration once they settle.

## Indexes worth knowing

- `Pub(lat)`, `Pub(lng)`: viewport queries until PostGIS replaces them.
- `TapListing(beerId, status)`: "where is X on draft".
- `TapListing(pubId, status)`: a pub's tap list.
- `SearchLog(beerId, createdAt)`, `SearchLog(place, createdAt)`: demand reports.
