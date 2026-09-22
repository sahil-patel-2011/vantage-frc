import { auth, getOnboardingGate, isEmail2faEnforced, sessionHasEmail2fa } from "@vantage/core";
import { withRls } from "@vantage/db";
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { safeAppPath } from "./lib/security/safe-navigation";
import { isPausedMediaRoute, MEDIA_ENABLED, MEDIA_PAUSED_MESSAGE } from "./lib/media-availability";
import { productRedirect, requestOrigin } from "./lib/products/products";

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
]);
// Session cookie auth for product routes; Better Auth enforces CSRF/Origin on /api/auth.
// Only intentionally public prefixes below — bootstrap-owner is token-gated + rate-limited.
const PUBLIC_PREFIXES = [
  "/api/auth",
  // Redeems a one-time Vantage ↔ Scouting handoff token; it is what creates the
  // session on this host, so it cannot require one (migration 0670).
  "/api/handoff/accept",
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
  // Unsigned desktop updater: version + download URLs. No secrets, no session.
  "/api/desktop/release",
  // Public release-notes feed for the desktop updater and marketing changelog:
  // published, everyone-audience releases only.
  "/api/desktop/updates",
  // Release-note publishing for coding agents/CI — bearer RELEASE_AGENT_TOKEN,
  // enforced by the route itself (no session cookie).
  "/api/agent/release-notes",
  // Pi relay pairing: the worker prints a code and polls; approval stays session-gated.
  "/api/relay/pair/start",
  "/api/relay/pair/poll",
  "/api/storage-node/pair/start",
  "/api/storage-node/pair/poll",
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

/**
 * Token-scoped public form intake only (migration 0601).
 *
 * A prospective student or a parent has no Vantage account, so a shared intake
 * link has to work without a session or it is not a share link at all. The
 * token is 32 hex characters of `gen_random_bytes(16)`, it is the entire
 * authorization, and both database calls behind it are SECURITY DEFINER
 * functions that return only an open, link-audience form and never any
 * responses. The signed-in `/forms` builder and `/api/forms` stay gated.
 */
function isPublicFormIntake(pathname: string) {
  return (
    /^\/f\/[a-f0-9]{32}$/.test(pathname) ||
    /^\/api\/public-forms\/[a-f0-9]{32}$/.test(pathname)
  );
}

/**
 * Token-scoped Vantage Drive share links only (migration 0641).
 *
 * Most of the people a team needs to hand a file to — a parent, a sponsor, a
 * judge, another team's mentor — have no Vantage account and never will, so a
 * share link that redirects to /signin is not a share link. The token is 32 hex
 * characters of `gen_random_bytes(16)`, it is the entire authorization, and
 * every database call behind it is a SECURITY DEFINER function that returns
 * only what the one named share covers and never any bytes belonging to
 * anything else. The signed-in `/files` page and `/api/drive` stay gated.
 */
function isPublicDriveShare(pathname: string) {
  return (
    /^\/s\/[a-f0-9]{32}$/.test(pathname) ||
    /^\/api\/drive-share\/[a-f0-9]{32}$/.test(pathname) ||
    /^\/api\/drive-share\/[a-f0-9]{32}\/download$/.test(pathname)
  );
}

function isPublic(pathname: string) {
  return (
    PUBLIC_PAGES.has(pathname) ||
    isPublicCalendarFeed(pathname) ||
    isPublicParentView(pathname) ||
    isPublicFormIntake(pathname) ||
    isPublicDriveShare(pathname) ||
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
  // Two products, one deployment: the Scouting host presents only Scouting's
  // pages and sends everything else to Vantage (lib/products/products.ts).
  const productTarget = productRedirect({
    host: request.headers.get("host"),
    pathname,
    search: request.nextUrl.search,
  });
  if (productTarget) {
    // An explicit Location: NextResponse.redirect relativises a URL it thinks
    // is same-origin, and in dev it believes both hosts are.
    const location = new URL(productTarget, requestOrigin(request)).toString();
    return new NextResponse(null, { status: 307, headers: { Location: location } });
  }
  // Run before public routes and auth: nobody can use paused media endpoints.
  if (isPausedMediaRoute(pathname, request.nextUrl.searchParams.get("tab")) ||
      (!MEDIA_ENABLED && request.method === "POST" && (
        pathname === "/api/business/assets" || pathname === "/api/branding/logo" ||
        /^\/api\/reimbursements\/[^/]+\/receipt$/.test(pathname)
      ))) {
    /*
      A page gets a page. This used to answer page requests with the same JSON
      as the API, so a student tapping "Match video" in the menu saw a raw
      `{"error":…,"code":"media_paused"}` object where the page should be. The
      menu still links these tools — the pause is one boolean away from being
      lifted, and hiding them would mean re-listing every one on the way back —
      so the page they land on has to explain itself.

      Redirected, not rewritten. A rewrite kept the address the person asked
      for, which read nicely, but it meant the server rendered the app shell
      for /media-paused while the browser hydrated it for /media — every
      component that reads the path disagreed, React threw "Hydration failed"
      and rebuilt the whole page on the client. Being honestly on /media-paused
      costs nothing: the page still names the tool, from `from`.
    */
    if (!pathname.startsWith("/api/") && (request.method === "GET" || request.method === "HEAD")) {
      const paused = new URL("/media-paused", request.url);
      paused.searchParams.set("from", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(paused, 307);
    }
    return NextResponse.json({ error: MEDIA_PAUSED_MESSAGE, code: "media_paused" }, { status: 403 });
  }
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
