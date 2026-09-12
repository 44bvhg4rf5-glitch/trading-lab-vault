import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { average, findBeersByQuery } from "@/lib/beers";
import { bboxAround, geocodePlace, haversineKm, type LatLng } from "@/lib/geo";

/**
 * GET /api/search?beer=asahi&near=Manchester[&radiusKm=5]
 * GET /api/search?beer=asahi&lat=53.48&lng=-2.24
 *
 * "Where can I get an Asahi in Manchester?" Returns pubs ranked by distance
 * that have a matching beer on tap. Also logs the search (anonymised unless
 * signed in) — this is the raw material for the demand-data product.
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const beerQ = url.searchParams.get("beer")?.trim() ?? "";
  const near = url.searchParams.get("near")?.trim() ?? "";
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const radiusKm = Math.min(Number(url.searchParams.get("radiusKm")) || 5, 30);

  if (!beerQ) return fail("beer is required");

  let center: LatLng | null = null;
  let placeLabel: string | null = null;
  if (near) {
    const g = await geocodePlace(near);
    if (!g) return fail(`Couldn't find a place called "${near}"`, 404, { code: "PLACE_NOT_FOUND" });
    center = { lat: g.lat, lng: g.lng };
    placeLabel = g.label;
  } else if (Number.isFinite(lat) && Number.isFinite(lng)) {
    center = { lat, lng };
  } else {
    return fail("Provide near=<place> or lat/lng");
  }

  const beers = await findBeersByQuery(beerQ, 20);
  const beerIds = beers.map((b) => b.id);

  const box = bboxAround(center, radiusKm);
  const pubs = beerIds.length
    ? await db.pub.findMany({
        where: {
          lat: { gte: box.south, lte: box.north },
          lng: { gte: box.west, lte: box.east },
          tapListings: { some: { status: "ACTIVE", beerId: { in: beerIds } } },
        },
        include: {
          subscription: { select: { plan: true } },
          tapListings: {
            where: { status: "ACTIVE", beerId: { in: beerIds } },
            include: { beer: { include: { brewery: true } }, ratings: { select: { score: true } } },
          },
        },
        take: 200,
      })
    : [];

  const results = pubs
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      lat: p.lat,
      lng: p.lng,
      street: p.street,
      city: p.city,
      postcode: p.postcode,
      plan: p.subscription?.plan ?? "FREE",
      distanceKm: Math.round(haversineKm(center!, p) * 10) / 10,
      matches: p.tapListings.map((t) => ({
        tapListingId: t.id,
        beer: t.beer.name,
        brewery: t.beer.brewery.name,
        pricePence: t.pricePence,
        lastSeenAt: t.lastSeenAt,
        avgScore: average(t.ratings.map((r) => r.score)),
        ratingCount: t.ratings.length,
      })),
    }))
    .filter((p) => p.distanceKm <= radiusKm)
    // Promoted pubs float to the top of ties; otherwise pure distance.
    .sort((a, b) => a.distanceKm - b.distanceKm || planRank(b.plan) - planRank(a.plan));

  const user = await getCurrentUser();
  await db.searchLog.create({
    data: {
      userId: user?.id,
      query: beerQ,
      beerId: beers[0]?.id,
      lat: center.lat,
      lng: center.lng,
      place: placeLabel,
    },
  });

  return ok({
    query: { beer: beerQ, near: placeLabel, center, radiusKm },
    matchedBeers: beers.map((b) => ({ id: b.id, name: b.name, brewery: b.brewery.name })),
    results,
  });
});

function planRank(plan: string) {
  return plan === "PROMOTED" ? 2 : plan === "LISTED" ? 1 : 0;
}
