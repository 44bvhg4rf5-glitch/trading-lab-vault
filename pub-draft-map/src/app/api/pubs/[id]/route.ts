import { db } from "@/lib/db";
import { fail, handle, ok, type RouteCtx } from "@/lib/api";
import { average } from "@/lib/beers";

/** GET /api/pubs/:id — full pub detail with tap list, ratings, photos, events, deals. */
export const GET = handle<RouteCtx<{ id: string }>>(async (_req, { params }) => {
  const { id } = await params;
  const pub = await db.pub.findUnique({
    where: { id },
    include: {
      subscription: true,
      tapListings: {
        where: { status: "ACTIVE" },
        include: {
          beer: { include: { brewery: true } },
          ratings: { select: { score: true } },
          photos: { include: { ratings: { select: { score: true } } }, orderBy: { createdAt: "desc" }, take: 6 },
        },
        orderBy: { lastSeenAt: "desc" },
      },
      events: { where: { OR: [{ endsAt: null, startsAt: { gte: new Date(Date.now() - 86400_000) } }, { endsAt: { gte: new Date() } }] }, orderBy: { startsAt: "asc" } },
      deals: { where: { OR: [{ validTo: null }, { validTo: { gte: new Date() } }] }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!pub) return fail("Pub not found", 404);

  return ok({
    ...pub,
    tapListings: pub.tapListings.map((t) => ({
      ...t,
      avgScore: average(t.ratings.map((r) => r.score)),
      ratingCount: t.ratings.length,
      photos: t.photos.map((ph) => ({
        ...ph,
        avgPourScore: average(ph.ratings.map((r) => r.score)),
        ratingCount: ph.ratings.length,
      })),
    })),
  });
});
