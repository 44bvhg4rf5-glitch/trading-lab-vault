import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { parseBBox } from "@/lib/geo";

/**
 * GET /api/pubs?bbox=south,west,north,east[&beer=asahi]
 * Pubs inside the map viewport, with their active tap count.
 * If `beer` is given, only pubs with a matching beer on tap.
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const bbox = parseBBox(url.searchParams.get("bbox"));
  if (!bbox) return fail("bbox=south,west,north,east is required");

  // Guard against someone asking for the whole planet.
  if (bbox.north - bbox.south > 2 || bbox.east - bbox.west > 3) {
    return fail("Zoom in: bbox too large", 400, { code: "BBOX_TOO_LARGE" });
  }

  const beer = url.searchParams.get("beer")?.trim();

  const pubs = await db.pub.findMany({
    where: {
      hidden: false,
      lat: { gte: bbox.south, lte: bbox.north },
      lng: { gte: bbox.west, lte: bbox.east },
      ...(beer
        ? {
            tapListings: {
              some: {
                status: "ACTIVE",
                beer: {
                  OR: [{ name: { contains: beer } }, { brewery: { name: { contains: beer } } }],
                },
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      kind: true,
      lat: true,
      lng: true,
      city: true,
      claimedById: true,
      subscription: { select: { plan: true } },
      _count: { select: { tapListings: { where: { status: "ACTIVE" } } } },
    },
    take: 500,
  });

  return ok({
    pubs: pubs.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      lat: p.lat,
      lng: p.lng,
      city: p.city,
      claimed: Boolean(p.claimedById),
      plan: p.subscription?.plan ?? "FREE",
      tapCount: p._count.tapListings,
    })),
  });
});
