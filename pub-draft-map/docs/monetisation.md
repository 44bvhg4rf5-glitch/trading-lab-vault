# Monetisation

Four lines, roughly in the order they switch on.

## 1. Advertising (day one, small)

- **Programmatic display** in three fixed slots (`AdSlot` component): map sidebar, pub page inline, native in results. Slots exist from day one so layouts never shift when ads go live. AdSense first; move to a UK publisher network (Ozone, Mediavine) at 100k+ monthly sessions.
- **Sponsored search** (the real ad product): a brewery pays to be the "Sponsored" row when someone searches its category or a competitor. "Searching for Peroni? Asahi is on at 3 pubs closer." High intent, geo-targeted, sold direct to brand teams. This is the only ad that belongs *inside* results, and it's always labelled.
- Rough numbers: UK beer/pub RPMs of £3–8 on display; sponsored search should clear £20+ per thousand searches once brands see conversion.

## 2. Pub subscriptions (month 2)

| Plan | £/month | Includes |
|---|---|---|
| Free | 0 | Claim, verified badge, tap-list control, city-level demand insight |
| Listed | 19 | + 4 live events, 2 live deals, event calendar on the pub page |
| Promoted | 49 | + unlimited events/deals, promoted placement in search and on the map, postcode-district demand insight |

Gates live in `src/lib/plans.ts`; endpoints return HTTP 402 with `code: PLAN_LIMIT` when a plan is exceeded, so the UI can upsell in context.

**Stripe wiring (not yet built):** `POST /api/pubs/:id/subscription` should create a Checkout Session in subscription mode with the plan's price id; a `/api/stripe/webhook` handler flips `PubSubscription.plan` on `checkout.session.completed` and `customer.subscription.updated/deleted`. Store `stripeCustomerId` and `stripeSubId` on `PubSubscription` (columns already exist). Until `STRIPE_SECRET_KEY` is set the endpoint runs in demo mode and switches plans directly.

Pub groups (Greene King, Stonegate, Mitchells & Butlers) buy per-estate, not per-pub: a group plan with bulk claim and a single dashboard is the enterprise SKU.

## 3. Demand data (month 4+)

What we know that nobody else does: **what people wanted, where, and whether they found it.**

- Searches per beer per area per week, including *unfulfilled* searches (searched, no result). An unfulfilled search is a stocking recommendation with a number on it.
- Posts and ratings per beer per area: what people actually drink and like.
- Price observations per beer per area from tap listings.

Products:
- **Area report** (pubs, included in Promoted): "In TW9 last month: 340 searches for Asahi, 12 unfulfilled. Top rated lager nearby: Camden Hells 4.4."
- **Brand dashboard** (breweries/distributors, £500–5,000/month by territory): where demand outstrips distribution, competitor share by area, price bands.
- **Data licence** (market research, EPOS vendors): quarterly aggregate extract.

Rules that keep this legal and sellable under UK GDPR: aggregates only, minimum cell size of 10 before any number is shown, no user identifiers ever leave the database, privacy policy says exactly this. `SearchLog` stores a nullable `userId` purely so we can honour deletion requests.

## 4. Affiliate / transactional (opportunistic)

- Deal redemptions: pubs pay per redeemed voucher instead of a subscription. Good for pubs that won't commit monthly.
- Ticketed events via a partner (DICE, Eventbrite) with a revenue share.
- Beer delivery affiliate for the beer page when nothing is on draft nearby.

## What not to do
- Don't sell placement that overrides distance ranking; promoted pubs only win ties. Trust in results is the asset.
- Don't gate the tap list or search behind an account. Reads are free, writes need a name.
