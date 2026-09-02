import { auth, getOnboardingGate, isEmail2faEnforced, sessionHasEmail2fa } from "@vantage/core";
import { withRls } from "@vantage/db";
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { safeAppPath } from "./lib/security/safe-navigation";

const PUBLIC_PAGES = new Set([
  "/",
  "/invite",
  "/features",
  "/features/cad",
  "/features/strategy",
  "/features/code",
  "/workflow",
  "/desktop",
  "/for-teams",
  "/pricing",
  "/privacy",
  "/terms",
  "/signin",
  "/sign-in",
  // Precached navigation shell for cold offline loads (CD #10).
  "/offline",
  // Token-gated email unsubscribe (no session).
  "/unsubscribe",
  // One-time-token self-serve exit interview (?token=, no session) — the
  // token is validated by /api/exit-interview/respond; see isPublicParentView
  // for the sibling token-scoped surface.
  "/exit-interview/respond",
]);
// Session cookie auth for product routes; Better Auth enforces CSRF/Origin on /api/auth.
// Only intentionally public prefixes below — bootstrap-owner is token-gated + rate-limited.
const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/invites/preview",
  "/api/waitlist",
  "/api/admin/bootstrap-owner",
  "/api/showcase/public",
  "/api/display/snapshot",
  "/api/strategy/draft/public",
  "/api/partner-placements",
  "/api/partner-assets",
  // Opt-in email one-click unsubscribe (token in body; no session).
  "/api/notifications/unsubscribe",
  // Self-serve exit interview: one-time token in query/body, resolved by a
  // SECURITY DEFINER lookup (0501) exactly like /api/parent-view/[token].
  "/api/exit-interview/respond",
  // Vercel cron jobs authenticate via CRON_SECRET (Bearer / x-cron-secret).
  "/api/cron",
  // Calendar ICS subscribe URLs are allow-listed in isPublicCalendarFeed (token path only).
  "/api/parts-relay",
  "/api/integrations/slack",
  "/parts-relay",
  "/showcase/present",
  "/strategy/board",
  "/display/kiosk",
  "/display/pit",
  // AI subscription bridge device traffic: pairing codes + device-token claim/heartbeat.
  "/api/ai-bridge/device",
  // Desktop shell browser-link sign-in: challenge start + poll + one-time code
  // exchange (no session cookie; approval itself stays session-gated).
  "/api/desktop/link",
  // CAD desktop CLI: pairing codes + device-token relay (no session cookie).
  "/api/cad/pair/start",
  "/api/cad/pair/poll",
  "/api/cad/relay",
  "/api/cad/compatibility",
  // Team agent-config bundle: session OR paired device token — the route
  // enforces both itself (apps/web/app/api/agent-config/bundle).
  "/api/agent-config/bundle",
  // VS Code / editor connector: device-code pair + bearer context (no session cookie).
  "/api/editor/pair/start",
  "/api/editor/pair/poll",
  "/api/editor/session",
  "/api/editor/context",
  // Generated social/SEO images must be crawlable without auth.
  "/opengraph-image",
  "/twitter-image",
];
const PUBLIC_FILE = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?|xml)$/i;

/** Tokenized ICS subscribe URLs only — never the session JSON calendar APIs. */
function isPublicCalendarFeed(pathname: string) {
  return /^\/api\/calendar\/feed\/[A-Za-z0-9_-]{16,100}$/.test(pathname);
}

/**
 * Public partner storefronts live at `/support/{uuid}` (and matching API).
 * Authenticated Soft-UI tickets use exact `/support` — keep that gated.
 */
function isPublicPartnerStorefront(pathname: string) {
  return (
    /^\/support\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pathname,
    ) ||
    /^\/api\/support\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pathname,
    )
  );
}

/**
 * Public sponsor thank-you walls live at `/sponsor-wall/{uuid}` (and matching API).
 * The authenticated builder uses exact `/sponsor-wall` — keep that gated.
 */
function isPublicSponsorWall(pathname: string) {
  return (
    /^\/sponsor-wall\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pathname,
    ) ||
    /^\/api\/sponsor-wall\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pathname,
    )
  );
}

/**
 * Token-scoped parent surfaces only (parent contacts have no Vantage account):
 * the read-only parent view page + API, and the one-click digest unsubscribe.
 * Narrow regexes on the opaque token — the bare `/parents` mentor page and the
 * session `/api/parents` management API stay gated.
 */
function isPublicParentView(pathname: string) {
  return (
    /^\/parent-view\/[A-Za-z0-9_-]{16,100}$/.test(pathname) ||
    /^\/api\/parent-view\/[A-Za-z0-9_-]{16,100}$/.test(pathname) ||
    /^\/api\/parents\/unsubscribe\/[A-Za-z0-9_-]{16,100}$/.test(pathname)
  );
}

function isPublic(pathname: string) {
  return (
    PUBLIC_PAGES.has(pathname) ||
    isPublicCalendarFeed(pathname) ||
    isPublicParentView(pathname) ||
    isPublicPartnerStorefront(pathname) ||
    isPublicSponsorWall(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    PUBLIC_FILE.test(pathname)
  );
}

function signInRedirect(request: NextRequest) {
  const signIn = new URL("/signin", request.url);
  signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signIn);
}

function onboardingRedirect(request: NextRequest) {
  const onboarding = new URL("/onboarding", request.url);
  const path = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (path !== "/dashboard" && path !== "/") {
    onboarding.searchParams.set("next", path);
  }
  return NextResponse.redirect(onboarding);
}

function postOnboardingRedirect(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");
  return NextResponse.redirect(new URL(safeAppPath(next), request.url));
}

function approvalPendingRedirect(request: NextRequest) {
  const onboarding = new URL("/onboarding", request.url);
  onboarding.searchParams.set("state", "pending");
  return NextResponse.redirect(onboarding);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const fixtureSession =
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_FIXTURE === "1" &&
    request.cookies.get("vantage-e2e-session")?.value === "authenticated";

  if (isPublic(pathname) && pathname !== "/signin" && pathname !== "/sign-in") {
    return NextResponse.next();
  }

  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  let authenticated = Boolean(fixtureSession);
  if (!authenticated && getSessionCookie(request)) {
    try {
      session = await auth.api.getSession({ headers: request.headers });
      authenticated = Boolean(session);
    } catch {
      authenticated = false;
    }
  }

  if (fixtureSession) {
    if (pathname === "/signin" || pathname === "/sign-in" || pathname === "/onboarding") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!authenticated || !session) {
    if (pathname === "/signin" || pathname === "/sign-in") return NextResponse.next();
    return signInRedirect(request);
  }

  const enforced = isEmail2faEnforced();
  const email2faOk = !enforced || sessionHasEmail2fa(session.session as { email2faVerifiedAt?: Date | string | null });

  if (!email2faOk) {
    if (pathname === "/signin" || pathname === "/sign-in" || pathname.startsWith("/api/auth")) {
      return NextResponse.next();
    }
    const verify = new URL("/signin", request.url);
    verify.searchParams.set("verify", "1");
    verify.searchParams.set("next", pathname.startsWith("/") ? pathname : "/dashboard");
    return NextResponse.redirect(verify);
  }

  const onboardingGate = await withRls({ userId: session.user.id }, (client) =>
    getOnboardingGate(client, session.user.id),
  ).catch(() => ({ onboardingComplete: false, workspaceApproved: false, accessStatus: "none" as const }));

  if (!onboardingGate.onboardingComplete) {
    if (
      pathname === "/onboarding" ||
      pathname === "/invite" ||
      pathname.startsWith("/api/onboarding") ||
      pathname.startsWith("/api/invites") ||
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/theme")
    ) {
      return NextResponse.next();
    }
    return onboardingRedirect(request);
  }

  if (!onboardingGate.workspaceApproved) {
    if (
      pathname === "/onboarding" ||
      pathname === "/invite" ||
      pathname === "/claim" ||
      pathname.startsWith("/api/onboarding") ||
      pathname.startsWith("/api/invites") ||
      pathname.startsWith("/api/organizations/claim") ||
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/theme")
    ) {
      return NextResponse.next();
    }
    return approvalPendingRedirect(request);
  }

  if (pathname === "/signin" || pathname === "/sign-in" || pathname === "/onboarding") {
    return postOnboardingRedirect(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
