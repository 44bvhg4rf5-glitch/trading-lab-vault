import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok, parseBody, type RouteCtx } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { average } from "@/lib/beers";

const schema = z.object({ score: z.number().int().min(1).max(5) });

/** POST /api/photos/:id/ratings — rate the pour (1–5). */
export const POST = handle<RouteCtx<{ id: string }>>(async (req, { params }) => {
  const user = await requireUser();
  const { id: photoId } = await params;
  const { score } = await parseBody(req, schema);

  const photo = await db.photo.findUnique({ where: { id: photoId } });
  if (!photo) return fail("Photo not found", 404);

  await db.photoRating.upsert({
    where: { photoId_userId: { photoId, userId: user.id } },
    update: { score },
    create: { photoId, userId: user.id, score },
  });
  const all = await db.photoRating.findMany({ where: { photoId }, select: { score: true } });
  return ok({ avgPourScore: average(all.map((r) => r.score)), ratingCount: all.length });
});
