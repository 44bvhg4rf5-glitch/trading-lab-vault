import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AuthError } from "./auth";

/** Shared helpers for route handlers. */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const json = await req.json().catch(() => null);
  return schema.parse(json);
}

/** Wrap a handler so thrown validation/auth errors become JSON responses. */
export function handle<Ctx>(
  fn: (req: Request, ctx: Ctx) => Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ZodError) {
        return fail("Invalid request", 422, { issues: err.issues });
      }
      if (err instanceof AuthError) {
        return fail(err.message, 401);
      }
      console.error(err);
      return fail("Internal error", 500);
    }
  };
}

export type RouteCtx<P extends Record<string, string>> = { params: Promise<P> };
