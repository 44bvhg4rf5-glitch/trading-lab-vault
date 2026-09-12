import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok, parseBody, type RouteCtx } from "@/lib/api";
import { requirePubOwner } from "@/lib/pub-owner";

const schema = z.object({ plan: z.enum(["FREE", "LISTED", "PROMOTED"]) });

/**
 * POST /api/pubs/:id/subscription  { plan }
 *
 * Demo mode: switches the plan directly. With STRIPE_SECRET_KEY set this
 * should instead create a Checkout Session and let the webhook flip the plan.
 * See docs/monetisation.md.
 */
export const POST = handle<RouteCtx<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const { pub, allowed } = await requirePubOwner(id);
  if (!pub) return fail("Pub not found", 404);
  if (!allowed) return fail("You don't manage this pub", 403);
  const { plan } = await parseBody(req, schema);

  if (process.env.STRIPE_SECRET_KEY) {
    return fail("Stripe checkout not wired yet — see docs/monetisation.md", 501);
  }

  const subscription = await db.pubSubscription.upsert({
    where: { pubId: id },
    update: { plan, status: "ACTIVE" },
    create: { pubId: id, plan },
  });
  return ok({ subscription, mode: "demo" });
});
