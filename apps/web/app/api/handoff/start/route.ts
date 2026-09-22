import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { newHandoffToken } from "../../../../lib/products/handoff";
import {
  SCOUTING_HOME,
  originFor,
  productsSplitAcrossHosts,
  type ProductId,
} from "../../../../lib/products/products";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { safeAppPath } from "../../../../lib/security/safe-navigation";

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000, namespace: "product-handoff-start" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Open Scouting" / "Back to Vantage".
 *
 * Mints a one-time handoff for the signed-in person and sends them to the
 * other product's host, which redeems it for its own session. When both
 * products share a host there is nothing to hand off and this is a redirect.
 */
export async function GET(request: Request) {
  if (!(await limiter.allow(anonymizeIp(clientIp(request), "handoff")))) {
    return rateLimitedResponse("Too many product switches. Wait a moment and try again.");
  }
  const url = new URL(request.url);
  const to: ProductId = url.searchParams.get("to") === "vantage" ? "vantage" : "scouting";
  const fallback = to === "scouting" ? SCOUTING_HOME : "/dashboard";
  const path = safeAppPath(url.searchParams.get("path"), fallback);
  const orgParam = url.searchParams.get("orgId");
  const orgId = orgParam && UUID.test(orgParam) ? orgParam : null;
  const withOrg = orgId && !path.includes("orgId=") ? `${path}${path.includes("?") ? "&" : "?"}orgId=${orgId}` : path;

  const origin = originFor(to);
  if (!productsSplitAcrossHosts() || !origin) {
    return NextResponse.redirect(new URL(withOrg, request.url), 303);
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(withOrg)}`, request.url), 303);
  }

  const { token, hash } = newHandoffToken();
  const sessionRow = session.session as { authMethod?: string | null; email2faVerifiedAt?: Date | string | null };
  const verifiedAt = sessionRow.email2faVerifiedAt ? new Date(sessionRow.email2faVerifiedAt).toISOString() : null;
  await withRls({ userId: session.user.id }, (client) =>
    client.query(`SELECT create_product_handoff($1, $2::uuid, $3, $4, $5, $6::timestamptz)`, [
      hash,
      orgId,
      new URL(origin).host,
      withOrg,
      sessionRow.authMethod ?? "unknown",
      verifiedAt,
    ]),
  );

  const response = NextResponse.redirect(`${origin}/api/handoff/accept?token=${token}`, 303);
  // The token is in the next URL; never let it leak through a Referer.
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
