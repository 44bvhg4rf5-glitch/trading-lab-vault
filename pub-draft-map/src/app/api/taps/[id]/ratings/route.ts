import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok, parseBody, type RouteCtx } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { average } from "@/lib/beers";

const ratingSchema = z.object({
  score: z.number().int().min(1).max(5),
  note: z.string().max(280).optional(),
});

/** POST /api/taps/:id/ratings — rate how good this beer is at this pub (1–5). */
export const POST = handle<RouteCtx<{ id: string }>>(async (req, { params }) => {
  const user = await requireUser();
  const { id: tapListingId } = await params;
  const body = await parseBody(req, ratingSchema);

  const listing = await db.tapListing.findUnique({ where: { id: tapListingId } });
  if (!listing) return fail("Listing not found", 404);

  await db.beerRating.upsert({
    where: { userId_tapListingId: { userId: user.id, tapListingId } },
    update: { score: body.score, note: body.note },
    create: { userId: user.id, tapListingId, beerId: listing.beerId, score: body.score, note: body.note },
  });

  const all = await db.beerRating.findMany({ where: { tapListingId }, select: { score: true } });
  return ok({ avgScore: average(all.map((r) => r.score)), ratingCount: all.length });
});
