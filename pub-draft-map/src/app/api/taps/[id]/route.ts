import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok, parseBody, type RouteCtx } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const patchSchema = z.object({
  action: z.enum(["confirm", "remove"]),
  pricePence: z.number().int().min(0).max(5000).optional(),
});

/**
 * PATCH /api/taps/:id  { action: "confirm" | "remove" }
 * confirm = "still on", remove = "gone / tap changed".
 */
export const PATCH = handle<RouteCtx<{ id: string }>>(async (req, { params }) => {
  await requireUser();
  const { id } = await params;
  const body = await parseBody(req, patchSchema);

  const existing = await db.tapListing.findUnique({ where: { id } });
  if (!existing) return fail("Listing not found", 404);

  const listing = await db.tapListing.update({
    where: { id },
    data:
      body.action === "confirm"
        ? // A human confirmation promotes an inferred/osm listing to a confirmed one.
          { status: "ACTIVE", removedAt: null, lastSeenAt: new Date(), confirmations: { increment: 1 }, pricePence: body.pricePence ?? undefined, source: "user", confidence: 1 }
        : { status: "REMOVED", removedAt: new Date() },
  });
  return ok({ listing });
});
