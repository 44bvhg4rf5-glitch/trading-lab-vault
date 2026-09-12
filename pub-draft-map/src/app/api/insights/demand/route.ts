import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

/**
 * GET /api/insights/demand?place=Manchester&days=30
 *
 * The data product in embryo: which beers people search for and post about,
 * by area. Aggregated only — never row-level user data. Gated to pub owners
 * and admins; the paid tier would expose this per postcode district.
 */
export const GET = handle(async (req) => {
  const user = await requireUser();
  if (user.role === "DRINKER") return fail("Available on pub and data plans", 403);

  const url = new URL(req.url);
  const place = url.searchParams.get("place")?.trim();
  const days = Math.min(Number(url.searchParams.get("days")) || 30, 365);
  const since = new Date(Date.now() - days * 86400_000);

  const [searches, posts] = await Promise.all([
    db.searchLog.groupBy({
      by: ["beerId"],
      where: { createdAt: { gte: since }, beerId: { not: null }, ...(place ? { place: { contains: place } } : {}) },
      _count: { _all: true },
      orderBy: { _count: { beerId: "desc" } },
      take: 20,
    }),
    db.photo.groupBy({
      by: ["tapListingId"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { tapListingId: "desc" } },
      take: 50,
    }),
  ]);

  const beerIds = searches.map((s) => s.beerId!).filter(Boolean);
  const beers = await db.beer.findMany({ where: { id: { in: beerIds } }, include: { brewery: true } });
  const byId = new Map(beers.map((b) => [b.id, b]));

  const listingIds = posts.map((p) => p.tapListingId);
  const listings = await db.tapListing.findMany({
    where: { id: { in: listingIds }, ...(place ? { pub: { city: { contains: place } } } : {}) },
    include: { beer: { include: { brewery: true } } },
  });
  const postsByBeer = new Map<string, { beer: string; brewery: string; photos: number }>();
  for (const l of listings) {
    const n = posts.find((p) => p.tapListingId === l.id)?._count._all ?? 0;
    const cur = postsByBeer.get(l.beerId) ?? { beer: l.beer.name, brewery: l.beer.brewery.name, photos: 0 };
    cur.photos += n;
    postsByBeer.set(l.beerId, cur);
  }

  return ok({
    place: place ?? "all",
    days,
    mostSearched: searches
      .filter((s) => byId.has(s.beerId!))
      .map((s) => ({ beer: byId.get(s.beerId!)!.name, brewery: byId.get(s.beerId!)!.brewery.name, searches: s._count._all })),
    mostPosted: [...postsByBeer.values()].sort((a, b) => b.photos - a.photos),
  });
});
