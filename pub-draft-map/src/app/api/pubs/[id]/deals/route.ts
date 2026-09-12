import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok, parseBody, type RouteCtx } from "@/lib/api";
import { PLAN_LIMITS, planOf, requirePubOwner } from "@/lib/pub-owner";

const schema = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().optional(),
});

/** POST /api/pubs/:id/deals — pub owner posts a deal (plan-gated). */
export const POST = handle<RouteCtx<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const { pub, allowed } = await requirePubOwner(id);
  if (!pub) return fail("Pub not found", 404);
  if (!allowed) return fail("You don't manage this pub", 403);

  const plan = planOf(pub.subscription?.plan);
  const limit = PLAN_LIMITS[plan].deals;
  const live = await db.deal.count({ where: { pubId: id, OR: [{ validTo: null }, { validTo: { gte: new Date() } }] } });
  if (live >= limit) {
    return fail(
      plan === "FREE" ? "Upgrade to a paid plan to post deals" : `Your ${plan} plan allows ${limit} live deals`,
      402,
      { code: "PLAN_LIMIT", plan },
    );
  }

  const body = await parseBody(req, schema);
  const deal = await db.deal.create({ data: { pubId: id, ...body, promoted: PLAN_LIMITS[plan].promoted } });
  return ok({ deal }, { status: 201 });
});
