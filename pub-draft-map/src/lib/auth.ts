import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";

/**
 * MVP auth: an email + display name creates a user and a signed session cookie.
 * No passwords, no email verification. Swap for Auth.js (magic link / OAuth)
 * before public launch; every caller goes through getCurrentUser() so the
 * replacement is one file.
 */

const COOKIE = "dm_session";
const TTL_DAYS = 30;

function secret() {
  return process.env.SESSION_SECRET ?? "dev-only-insecure-secret";
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function verify(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const expected = sign(id);
  if (expected.length !== sig.length) return null;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? id : null;
}

export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const sessionId = verify(token);
  if (!sessionId) return null;
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

export class AuthError extends Error {
  constructor() {
    super("Sign in required");
  }
}

export async function signIn(email: string, displayName: string) {
  const user = await db.user.upsert({
    where: { email: email.toLowerCase() },
    update: { displayName },
    create: { email: email.toLowerCase(), displayName },
  });
  const session = await db.session.create({
    data: {
      userId: user.id,
      expiresAt: new Date(Date.now() + TTL_DAYS * 86400_000),
    },
  });
  const jar = await cookies();
  jar.set(COOKIE, `${session.id}.${sign(session.id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_DAYS * 86400,
  });
  return user;
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const id = verify(token);
    if (id) await db.session.deleteMany({ where: { id } });
  }
  jar.delete(COOKIE);
}
