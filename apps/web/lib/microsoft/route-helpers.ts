import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { HttpError } from "./authz";
import { NOT_MIGRATED_MESSAGE, isMissingRelation } from "./connection-store";

/** Shared plumbing for /api/integrations/microsoft/* — session, redirects, error JSON. */

export async function currentUser(): Promise<{ id: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ? { id: session.user.id } : null;
}

export async function requireUser(): Promise<{ id: string }> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in to manage this team's Microsoft Excel connection.", "unauthenticated");
  return user;
}

export function appBaseUrl(requestUrl: URL): string {
  return (process.env.BETTER_AUTH_URL ?? requestUrl.origin).replace(/\/$/, "");
}

/** Where the Connect flow lands afterwards: the Connectors page, scrolled to the Excel card. */
export function connectorsRedirect(
  base: string,
  orgId: string | null,
  status: "connected" | "error",
  reason?: string,
): Response {
  const params = new URLSearchParams();
  if (orgId) params.set("orgId", orgId);
  params.set("microsoft", status);
  if (reason) params.set("reason", reason);
  return Response.redirect(`${base}/connectors?${params.toString()}#microsoft-excel`, 303);
}

const NO_STORE = { "Cache-Control": "private, no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function failJson(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  if (isMissingRelation(error)) return json({ error: NOT_MIGRATED_MESSAGE, code: "not_migrated", setupRequired: true }, 503);
  // Never echo raw errors: they can carry SQL or upstream detail. Log the class only.
  console.error("[microsoft-excel]", error instanceof Error ? error.name : typeof error);
  return json({ error: "The request failed. Try again in a moment.", code: "failed" }, 500);
}

export async function readOrgIdFromRequest(request: Request): Promise<unknown> {
  const fromQuery = new URL(request.url).searchParams.get("orgId");
  if (fromQuery) return fromQuery;
  const body = (await request.json().catch(() => ({}))) as { orgId?: unknown };
  return body.orgId;
}
