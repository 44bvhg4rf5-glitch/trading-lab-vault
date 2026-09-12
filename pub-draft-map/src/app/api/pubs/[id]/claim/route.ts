import { db } from "@/lib/db";
import { fail, handle, ok, type RouteCtx } from "@/lib/api";
import { requireUser } from "@/lib/auth";

/**
 * POST /api/pubs/:id/claim — a landlord claims their pub.
 * MVP: instant claim. Production: verify via phone call to the listed number,
 * a postcard code, or a Companies House / premises licence match.
 */
export const POST = handle<RouteCtx<{ id: string }>>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;

  const pub = await db.pub.findUnique({ where: { id }, select: { id: true, claimedById: true } });
  if (!pub) return fail("Pub not found", 404);
  if (pub.claimedById && pub.claimedById !== user.id) return fail("This pub is already claimed", 409);

  const [updated] = await db.$transaction([
    db.pub.update({ where: { id }, data: { claimedById: user.id, claimedAt: new Date() } }),
    db.user.update({ where: { id: user.id }, data: { role: user.role === "ADMIN" ? "ADMIN" : "PUB_OWNER" } }),
    db.pubSubscription.upsert({ where: { pubId: id }, update: {}, create: { pubId: id, plan: "FREE" } }),
  ]);
  return ok({ pub: updated });
});
