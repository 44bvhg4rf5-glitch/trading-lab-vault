import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { fail, handle, ok, type RouteCtx } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
]);

/**
 * POST /api/taps/:id/photos  (multipart: file, kind, caption)
 * Dev: writes to public/uploads. Prod: replace `store()` with S3/R2 upload.
 */
export const POST = handle<RouteCtx<{ id: string }>>(async (req, { params }) => {
  const user = await requireUser();
  const { id: tapListingId } = await params;

  const listing = await db.tapListing.findUnique({ where: { id: tapListingId } });
  if (!listing) return fail("Listing not found", 404);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("file is required");
  if (file.size > MAX_BYTES) return fail("Image too large (max 8MB)", 413);
  const ext = ALLOWED.get(file.type);
  if (!ext) return fail("Unsupported image type");

  const kind = String(form.get("kind") ?? "POUR").toUpperCase();
  if (!["POUR", "BEER", "VENUE"].includes(kind)) return fail("kind must be POUR, BEER or VENUE");
  const caption = form.get("caption") ? String(form.get("caption")).slice(0, 200) : null;

  const url = await store(file, ext);
  const photo = await db.photo.create({
    data: { userId: user.id, tapListingId, url, kind, caption },
  });
  return ok({ photo }, { status: 201 });
});

async function store(file: File, ext: string): Promise<string> {
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}
