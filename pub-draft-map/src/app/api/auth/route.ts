import { z } from "zod";
import { handle, ok, parseBody } from "@/lib/api";
import { getCurrentUser, signIn, signOut } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(40),
});

/** GET /api/auth — who am I. */
export const GET = handle(async () => {
  const user = await getCurrentUser();
  return ok({ user: user ? { id: user.id, email: user.email, displayName: user.displayName, role: user.role } : null });
});

/** POST /api/auth — demo sign-in (see src/lib/auth.ts for the caveat). */
export const POST = handle(async (req) => {
  const body = await parseBody(req, schema);
  const user = await signIn(body.email, body.displayName);
  return ok({ user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
});

/** DELETE /api/auth — sign out. */
export const DELETE = handle(async () => {
  await signOut();
  return ok({ ok: true });
});
