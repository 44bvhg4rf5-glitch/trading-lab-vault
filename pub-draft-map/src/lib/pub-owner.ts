import { db } from "./db";
import { requireUser } from "./auth";

export { PLAN_LIMITS, planOf, type Plan } from "./plans";

/** Resolve the signed-in user and check they own (or admin) the pub. */
export async function requirePubOwner(pubId: string) {
  const user = await requireUser();
  const pub = await db.pub.findUnique({ where: { id: pubId }, include: { subscription: true } });
  if (!pub) return { user, pub: null, allowed: false as const };
  const allowed = user.role === "ADMIN" || pub.claimedById === user.id;
  return { user, pub, allowed };
}
