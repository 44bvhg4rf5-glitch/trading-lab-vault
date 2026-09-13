import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { average, findBeersByQuery } from "@/lib/beers";
import { bboxAround, geocodePlace, haversineKm, type LatLng } from "@/lib/geo";

/**
 * GET /api/search?beer=asahi&near=Harefield[&radiusKm=5]   beer near a place
 * GET /api/search?near=Harefield                            every pub near a place
 * GET /api/search?beer=asahi&lat=53.48&lng=-2.24           beer near coordinates
 * GET /api/search?beer=asahi                                everywhere it's on tap
 *
 * Pubs ranked by distance. When a beer is given, only pubs with a matching
 * beer on tap; when none match nearby, the nearby pubs are returned with
 * `matches: []` so the user can add it. Every search with a beer is logged
 * (anonymised unless signed in): raw material for the demand-data product.
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const beerQ = url.searchParams.get("beer")?.trim() ?? "";
  const near = url.searchParams.get("near")?.trim() ?? "";
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const requestedRadius = Math.min(Number(url.searchParams.get("radiusKm")) || 0, 30);

  if (!beerQ && !near && !(Number.isFinite(lat) && Number.isFinite(lng))) {
    return fail("Provide a beer, a place, or coordinates");
  }

  let center: LatLng | null = null;
  let placeLabel: string | null = null;
  if (near) {
    const g = await geocodePlace(near);
    if (!g) return fail(`Couldn't find a place called "${near}" in the UK`, 404, { code: "PLACE_NOT_FOUND" });
    center = { lat: g.lat, lng: g.lng };
    placeLabel = g.label;
  } else if (Number.isFinite(lat) && Number.isFinite(lng)) {
    center = { lat, lng };
  }

  const beers = beerQ ? await findBeersByQuery(beerQ, 20) : [];
  const beerIds = beers.map((b) => b.id);
  const beerFilter = beerQ ? { tapListings: { some: { status: "ACTIVE", beerId: { in: beerIds } } } } : {};
  const include = {
    subscription: { select: { plan: true } },
    tapListings: {
      where: { status: "ACTIVE", ...(beerQ ? { beerId: { in: beerIds } } : {}) },
      include: { beer: { include: { brewery: true } }, ratings: { select: { score: true } } },
    },
    _count: { select: { tapListings: { where: { status: "ACTIVE" } } } },
  } as const;

  type Row = Awaited<ReturnType<typeof db.pub.findMany<{ include: typeof include }>>>[number];
  let pubs: Row[] = [];
  let radiusKm = requestedRadius;
  let mode: "beer-near" | "near" | "beer-anywhere" | "beer-near-miss" = beerQ ? (center ? "beer-near" : "beer-anywhere") : "near";

  if (center) {
    // Widen until there is something worth showing.
    const steps = requestedRadius ? [requestedRadius] : [2, 4, 8, 15, 30];
    for (const r of steps) {
      radiusKm = r;
      const box = bboxAround(center, r);
      const geo = { lat: { gte: box.south, lte: box.north }, lng: { gte: box.west, lte: box.east } };
      if (beerQ && beerIds.length) {
        pubs = await db.pub.findMany({ where: { ...geo, ...beerFilter }, include, take: 200 });
        if (pubs.length) break;
      } else if (!beerQ) {
        pubs = await db.pub.findMany({ where: geo, include, take: 300 });
        if (pubs.length >= 8) break;
      } else break;
    }
    if (beerQ && !pubs.length) {
      // Nothing pours it nearby: show the nearby pubs so the user can add it.
      mode = "beer-near-miss";
      const box = bboxAround(center, radiusKm);
      pubs = await db.pub.findMany({
        where: { lat: { gte: box.south, lte: box.north }, lng: { gte: box.west, lte: box.east } },
        include: { ...include, tapListings: { where: { status: "ACTIVE", beerId: { in: [] } }, include: include.tapListings.include } },
        take: 60,
      });
    }
  } else if (beerIds.length) {
    pubs = await db.pub.findMany({ where: beerFilter, include, take: 300 });
  }

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
      tapCount: p._count.tapListings,
      distanceKm: center ? Math.round(haversineKm(center, p) * 10) / 10 : null,
      matches: p.tapListings.map((t) => ({
        tapListingId: t.id,
        beer: t.beer.name,
        brewery: t.beer.brewery.name,
        pricePence: t.pricePence,
        lastSeenAt: t.lastSeenAt,
        source: t.source,
        confidence: t.confidence,
        avgScore: average(t.ratings.map((r) => r.score)),
        ratingCount: t.ratings.length,
      })),
    }))
    .filter((p) => p.distanceKm == null || p.distanceKm <= radiusKm)
    // Confirmed sightings beat inferred ones; then distance.
    .sort(
      (a, b) =>
        Math.max(0, ...b.matches.map((m) => m.confidence)) - Math.max(0, ...a.matches.map((m) => m.confidence)) ||
        (a.distanceKm ?? 0) - (b.distanceKm ?? 0) ||
        planRank(b.plan) - planRank(a.plan) ||
        b.tapCount - a.tapCount ||
        (a.city ?? "").localeCompare(b.city ?? ""),
    );

  if (beerQ) {
    const user = await getCurrentUser();
    await db.searchLog.create({
      data: { userId: user?.id, query: beerQ, beerId: beers[0]?.id, lat: center?.lat, lng: center?.lng, place: placeLabel },
    });
  }

  return ok({
    query: { beer: beerQ || null, near: placeLabel, center, radiusKm: center ? radiusKm : null, mode },
    matchedBeers: beers.map((b) => ({ id: b.id, name: b.name, brewery: b.brewery.name })),
    results,
  });
});

function planRank(plan: string) {
  return plan === "PROMOTED" ? 2 : plan === "LISTED" ? 1 : 0;
}
