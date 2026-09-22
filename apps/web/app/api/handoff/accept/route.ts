import { auth } from "@vantage/core";
import { NextResponse } from "next/server";
import { consumeHandoff, isHandoffTokenShape } from "../../../../lib/products/handoff";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { requestOrigin } from "../../../../lib/products/products";
import { safeAppPath } from "../../../../lib/security/safe-navigation";

const limiter = createRateLimiter({ limit: 20, windowMs: 60_000, namespace: "product-handoff-accept" });

function hostOf(request: Request): string {
  // The Host header is what the browser actually asked for; the token is bound
  // to a host, so this is defence in depth on top of single use and a 60s TTL.
  return (request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? new URL(request.url).host)
    .split(",")[0]!
    .trim()
    .toLowerCase();
}

function noStore(response: NextResponse) {
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * The destination half of the handoff: redeem the token for this host, mint
 * this host's own Better Auth session for that person, and continue to the
 * page they asked for. A used, expired, forged or wrong-host token gets the
 * normal sign-in page — never a partial session.
 */
export async function GET(request: Request) {
  if (!(await limiter.allow(anonymizeIp(clientIp(request), "handoff")))) {
    return rateLimitedResponse("Too many sign-in handoffs. Wait a minute and try again.");
  }
  const token = new URL(request.url).searchParams.get("token");
  const origin = requestOrigin(request);
  const signIn = () => noStore(NextResponse.redirect(new URL("/signin?handoff=expired", origin), 303));
  if (!isHandoffTokenShape(token)) return signIn();

  let consumed;
  try {
    consumed = await consumeHandoff(token, hostOf(request));
  } catch {
    return signIn();
  }
  if (!consumed) return signIn();

  try {
    const minted = await auth.api.createProductHandoffSession({
      body: {
        userId: consumed.userId,
        authMethod: consumed.authMethod,
        email2faVerifiedAt: consumed.email2faVerifiedAt,
      },
      headers: request.headers,
      returnHeaders: true,
    });
    const response = NextResponse.redirect(new URL(safeAppPath(consumed.targetPath, "/"), origin), 303);
    for (const cookie of minted.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
    return noStore(response);
  } catch {
    return signIn();
  }
}
