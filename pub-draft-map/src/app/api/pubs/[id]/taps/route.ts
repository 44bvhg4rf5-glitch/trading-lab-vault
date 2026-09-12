import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok, parseBody, type RouteCtx } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { upsertBeer } from "@/lib/beers";

const addTapSchema = z.object({
  beerName: z.string().min(1).max(120),
  breweryName: z.string().min(1).max(120),
  style: z.string().max(40).optional(),
  abv: z.number().min(0).max(80).optional(),
  pricePence: z.number().int().min(0).max(5000).optional(),
  servingMl: z.number().int().min(100).max(1000).optional(),
});

/** POST /api/pubs/:id/taps — report a beer on draft at this pub. */
export const POST = handle<RouteCtx<{ id: string }>>(async (req, { params }) => {
  const user = await requireUser();
  const { id: pubId } = await params;
  const body = await parseBody(req, addTapSchema);

  const pub = await db.pub.findUnique({ where: { id: pubId }, select: { id: true } });
  if (!pub) return fail("Pub not found", 404);

  const beer = await upsertBeer({ name: body.beerName, breweryName: body.breweryName, style: body.style, abv: body.abv });
  const listing = await db.tapListing.upsert({
    where: { pubId_beerId: { pubId, beerId: beer.id } },
    update: {
      status: "ACTIVE",
      removedAt: null,
      lastSeenAt: new Date(),
      confirmations: { increment: 1 },
      pricePence: body.pricePence ?? undefined,
      servingMl: body.servingMl ?? undefined,
    },
    create: {
      pubId,
      beerId: beer.id,
      reportedById: user.id,
      pricePence: body.pricePence,
      servingMl: body.servingMl ?? 568,
    },
    include: { beer: { include: { brewery: true } } },
  });
  return ok({ listing }, { status: 201 });
});
