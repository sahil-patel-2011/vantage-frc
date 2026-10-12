import type { PoolClient } from "@neondatabase/serverless";
import { assertPlatformAdmin, auth, PlatformAdminRequiredError } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { publicErrorMessage } from "../security/public-error";
import { sessionIsFresh } from "../team-lifecycle/model";

/**
 * The shared shape of a platform-admin route: a session, a withRls transaction that first checks
 * `platform_admins`, and one error answer. A non-admin always gets 404, so the area never says
 * it exists.
 */

export const NO_STORE = { "cache-control": "private, no-store, max-age=0" } as const;

export class AdminRouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AdminRouteError";
  }
}

type AdminSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export async function adminSession(): Promise<AdminSession> {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new AdminRouteError(401, "Sign in again to continue.", "auth_required");
  return value;
}

/**
 * Run `work` as a platform admin. `fresh` also requires a sign-in from the last 24 hours (the
 * same rule as deleting a team), for changes that hand out power: admins and AI credit.
 */
export async function asPlatformAdmin<T>(
  work: (client: PoolClient, session: AdminSession) => Promise<T>,
  options: { fresh?: boolean } = {},
): Promise<T> {
  const session = await adminSession();
  return withRls({ userId: session.user.id }, async (client) => {
    await assertPlatformAdmin(client);
    // Checked after the admin check, so a non-admin learns nothing from the answer.
    if (options.fresh && !sessionIsFresh(session.session.createdAt)) {
      throw new AdminRouteError(
        403,
        "For your security, sign in again before making this change. It only takes a moment.",
        "reauth_required",
      );
    }
    return work(client, session);
  });
}

/** A Postgres "function/table does not exist": the database is missing a migration. */
export function isMissingSchema(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code ?? "");
  return code === "42883" || code === "42P01";
}

export function adminErrorResponse(error: unknown, fallback: string, mapped?: (error: unknown) => AdminRouteError | null): Response {
  if (error instanceof PlatformAdminRequiredError) {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  if (error instanceof AdminRouteError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
  }
  const specific = mapped?.(error);
  if (specific) {
    return Response.json({ error: specific.message, code: specific.code }, { status: specific.status, headers: NO_STORE });
  }
  const message = error instanceof Error ? error.message : "";
  if (/platform administrator/i.test(message)) return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (/step-up is required/i.test(message)) {
    return Response.json(
      { error: "Confirm it's you with your authenticator app first (Account → Security), then try again.", code: "mfa_required" },
      { status: 403, headers: NO_STORE },
    );
  }
  return Response.json({ error: publicErrorMessage(error, fallback) }, { status: 500, headers: NO_STORE });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
