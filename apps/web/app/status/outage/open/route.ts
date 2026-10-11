import { NextResponse } from "next/server";
import { CONSOLE_COOKIE, verifyConsoleToken } from "../../../../lib/outage/console-token";

export const dynamic = "force-dynamic";

/**
 * GET /status/outage/open?t=<signed link> — where the alert email points.
 *
 * Swaps the link's key for an HttpOnly cookie and redirects to /status/outage, so the page
 * that renders (and the analytics script it loads) never sees the key in its address, and it
 * isn't left in browser history. SameSite=Lax because the click comes from an email client:
 * a Strict cookie set during a cross-site navigation isn't sent on the redirect.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const checked = verifyConsoleToken(token);
  const target = new URL("/status/outage", url);
  if (!checked.ok) {
    target.searchParams.set("problem", checked.reason);
    return NextResponse.redirect(target, 303);
  }
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(CONSOLE_COOKIE, token, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, Math.floor((checked.expiresAt - Date.now()) / 1000)),
  });
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("cache-control", "no-store");
  return response;
}
