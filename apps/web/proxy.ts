import { auth, getOnboardingGate, isEmail2faEnforced, sessionHasEmail2fa } from "@vantage/core";
import { withRls } from "@vantage/db";
import { BACKUP_MODE_MESSAGE, isBackupMode } from "@vantage/db/backup-mode";
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { onboardingReturnPath } from "./lib/onboarding/entry-journey";
import { isPausedMediaRoute, MEDIA_ENABLED, MEDIA_PAUSED_MESSAGE } from "./lib/media-availability";
import { productRedirect, requestOrigin } from "./lib/products/products";
import { isPendingWorkspacePath } from "./lib/onboarding/pending-paths";
import { isGoogleSheetsState } from "./lib/google-sheets/oauth-state";
import { isKnownAppPath } from "./lib/nav/app-route-roots";
import {
  REMEMBERED_TEAM_COOKIE,
  TEAM_SCOPED_PAGES,
  chooseMemberTeam,
  isTeamId,
  notOnTeamRedirect,
  teamPageRedirect,
} from "./lib/nav/remembered-team";
import { memberTeamIds } from "./lib/nav/member-teams";
import { pendingProvisioningTeam, requestedProvisioningTeam } from "./lib/provisioning/request-gate";
import { noteDatabaseFailure } from "./lib/outage/note";
import { backupModeRoute } from "./lib/outage/backup-routes";
import { SIGNED_OUT_MESSAGE } from "./lib/security/signed-out";

const PUBLIC_PAGES = new Set([
  "/",
  "/invite",
  "/join-team",
  "/access-unavailable",
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
  // Laptop setup script, fetched by `irm … | iex` before the student has an account.
  "/team-setup.ps1",
  // The Claude Code connector (/team/ai-bridge step 2), fetched on the computer that runs it.
  "/vantage-ai-bridge.mjs",
]);
// Session cookie auth for product routes; Better Auth enforces CSRF/Origin on /api/auth.
// Only intentionally public prefixes below — bootstrap-owner is token-gated + rate-limited.
const PUBLIC_PREFIXES = [
  "/api/auth",
  // Redeems a one-time Vantage ↔ Scouting handoff token; it is what creates the
  // session on this host, so it cannot require one (migration 0670).
  "/api/handoff/accept",
  // Sign-in with a recovery email: sends and checks its own codes, then sets the session.
  "/api/recovery",
  "/api/invites/preview",
  "/api/teams/join",
  "/api/waitlist",
  // Uptime monitor: says only whether the database answers.
  "/api/health",
  // Outage handling works while the database (and so every session) is down: the public
  // "limited" flag reads no database, and the outage console and its API (/api/status/outage)
  // are authorized by the HMAC-signed link in the owner's alert email, checked in each route.
  "/api/status",
  "/status/outage",
  "/api/admin/bootstrap-owner",
  "/api/showcase/public",
  "/api/display/snapshot",
  // The phase-aware event board's feed and match notes: token-gated in the route itself.
  "/api/display/stage",
  "/api/display/intel",
  "/api/strategy/draft/public",
  "/api/partner-placements",
  "/api/partner-assets",
  // Opt-in email one-click unsubscribe (token in body; no session).
  "/api/notifications/unsubscribe",
  // Vercel cron jobs authenticate via CRON_SECRET (Bearer / x-cron-secret).
  "/api/cron",
  // Signed webhooks: no cookie ever comes with them, and each route verifies the sender's
  // signature over the raw body before doing anything (Stripe-Signature, X-TBA-HMAC,
  // X-Hub-Signature-256 against the team's own secret). Without these the proxy answered 401
  // before the route ran, so billing events and TBA pushes never arrived.
  "/api/stripe/webhook",
  "/api/webhooks/tba",
  "/api/github/webhook",
  // Calendar ICS subscribe URLs are allow-listed in isPublicCalendarFeed (token path only).
  "/api/parts-relay",
  "/api/integrations/slack",
  "/parts-relay",
  "/showcase/present",
  "/strategy/board",
  "/display/kiosk",
  "/display/pit",
  "/display/stage",
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
  // CAD desktop CLI: pairing codes + device-token relay (no session cookie).
  "/api/cad/pair/start",
  "/api/cad/pair/poll",
  "/api/cad/relay",
  "/api/cad/compatibility",
  // Team agent-config bundle: session OR paired device token — the route
  // enforces both itself (apps/web/app/api/agent-config/bundle).
  "/api/agent-config/bundle",
  // Google Sheets connect callback: proves itself with the HMAC-signed OAuth state (user +
  // team, 15-minute expiry, PKCE), because Google may return to a host with no cookie.
  "/api/integrations/google/callback",
  // VS Code / editor connector: device-code pair + bearer context (no session cookie).
  "/api/editor/pair/start",
  "/api/editor/pair/poll",
  "/api/editor/session",
  "/api/editor/context",
  // Generated social/SEO images must be crawlable without auth.
  "/opengraph-image",
  "/twitter-image",
];
const MARKETING_ALIASES: Record<string, string> = {
  "/waitlist": "/#waitlist",
  "/join": "/#waitlist",
  "/signup": "/#waitlist",
  "/sign-up": "/#waitlist",
  "/register": "/#waitlist",
  "/request-access": "/#waitlist",
  // The URLs people guess for signing in. /login was the 404 page.
  "/login": "/signin",
  "/log-in": "/signin",
  // The footer's contact column, with the address written out: a mailto: redirect left a laptop
  // with no mail app on a blank page.
  "/contact": "/#contact",
  // The page is called "Cost" everywhere a person reads it.
  "/cost": "/pricing",
  "/about": "/for-teams",
};
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
  return NextResponse.redirect(new URL(onboardingReturnPath(next, "/dashboard"), request.url));
}

/** A failed lookup is not proof of sign-out or unfinished onboarding. */
function accessUnavailable(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") || !["GET", "HEAD"].includes(request.method)) {
    return NextResponse.json({ error: "Your account access could not be checked. Try again shortly.", code: "access_check_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store", "retry-after": "10" } });
  }
  const destination = new URL("/access-unavailable", request.url);
  destination.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(destination, { status: 307, headers: { "cache-control": "private, no-store" } });
}

function approvalPendingRedirect(request: NextRequest) {
  const onboarding = new URL("/onboarding", request.url);
  onboarding.searchParams.set("state", "pending");
  return NextResponse.redirect(onboarding);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Connect Google Sheets reuses the one Google redirect URI already registered for
  // sign-in. Its callbacks carry a Sheets state; send those to the Sheets handler (which
  // verifies the state's HMAC) and leave every sign-in callback to Better Auth.
  if (pathname === "/api/auth/callback/google" && isGoogleSheetsState(request.nextUrl.searchParams.get("state"))) {
    const target = new URL("/api/integrations/google/callback", request.url);
    target.search = request.nextUrl.search;
    return NextResponse.rewrite(target);
  }
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
  // Addresses people type or get told ("go to vantage…/waitlist") land on the waitlist or an
  // email, not on a sign-in form for an invite-only product they cannot use yet.
  const alias = MARKETING_ALIASES[pathname];
  if (alias) return NextResponse.redirect(alias.startsWith("mailto:") ? alias : new URL(alias, request.url), 308);
  // Run before public routes and auth: nobody can use paused media endpoints.
  if (isPausedMediaRoute(pathname, request.nextUrl.searchParams.get("tab")) ||
      (!MEDIA_ENABLED && request.method === "POST" && (
        // Document receipts have their own PDF-only validation. Legacy images stay readable.
        pathname === "/api/business/assets" || pathname === "/api/branding/logo"
      ))) {
    /*
      A page gets a page. This used to answer page requests with the same JSON
      as the API, so a student tapping "Match video" in the menu saw a raw
      `{"error":…,"code":"media_paused"}` object where the page should be. The
      retired links still need a useful explanation.

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
  // Backup mode (VANTAGE_BACKUP_MODE): there is no database, so no session to look up. The public
  // site passes, an API call that needs data gets one clear 503, and every other page goes to
  // the sign-in page, which explains backup mode (lib/outage/backup-routes.ts).
  if (isBackupMode()) {
    const route = backupModeRoute(pathname);
    if (route === "pass") return NextResponse.next();
    if (route === "api_unavailable") {
      return NextResponse.json(
        { error: BACKUP_MODE_MESSAGE, code: "backup_mode" },
        { status: 503, headers: { "cache-control": "no-store", "retry-after": "300" } },
      );
    }
    const notice = new URL("/signin", request.url);
    notice.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(notice, { status: 307, headers: { "cache-control": "no-store" } });
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
    } catch (error) {
      // Sessions live in the database: while it is down, every signed-in request ends here, so
      // this is where an outage is first seen (lib/outage; deferred, never throws).
      noteDatabaseFailure(error, "sign-in check");
      return accessUnavailable(request);
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
    // Fetch follows redirects: a sign-in page would become a misleading 200
    // instead of letting product screens recognize an expired session.
    // The same sentence the routes use (e.g. /api/onboarding), so a signed-out answer reads one way.
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });
    // An address that is no page at all gets the 404, not a sign-in form that leads nowhere.
    if (!isKnownAppPath(pathname)) return NextResponse.next();
    return signInRedirect(request);
  }

  const enforced = isEmail2faEnforced();
  const email2faOk = !enforced || sessionHasEmail2fa(session.session as { email2faVerifiedAt?: Date | string | null });

  if (!email2faOk) {
    if (pathname === "/signin" || pathname === "/sign-in" || pathname.startsWith("/api/auth")) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Complete email verification to continue", code: "email_verification_required" }, { status: 403 });
    const verify = new URL("/signin", request.url);
    verify.searchParams.set("verify", "1");
    verify.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(verify);
  }

  const onboardingGate = await withRls({ userId: session.user.id }, (client) =>
    getOnboardingGate(client, session.user.id),
  ).catch((error: unknown) => {
    noteDatabaseFailure(error, "sign-in check");
    return null;
  });
  if (!onboardingGate) return accessUnavailable(request);

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
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Complete your profile to continue", code: "onboarding_required" }, { status: 403 });
    return onboardingRedirect(request);
  }

  if (!onboardingGate.workspaceApproved) {
    // Profile is saved. Docs, account, and two-factor stay open so the
    // "while you wait" links are real pages, not a bounce back here.
    if (isPendingWorkspacePath(pathname)) return NextResponse.next();
    // A page left open after its owner took this person off the team lands here on every save;
    // "Team approval is required" read as a fault (QA A3-15). Reloading shows why.
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "You're not on this team any more, or not yet. Reload the page to see why and what to do next.", code: "workspace_approval_required" }, { status: 403 });
    return approvalPendingRedirect(request);
  }

  if (pathname === "/signin" || pathname === "/sign-in" || pathname === "/onboarding") {
    return postOnboardingRedirect(request);
  }

  // Team pages: which of the person's own teams this page is for (lib/nav/remembered-team.ts).
  const pageRequest = !pathname.startsWith("/api/") && (request.method === "GET" || request.method === "HEAD");
  const opened = pageRequest ? request.nextUrl.searchParams.get("orgId") : null;
  const remembered = request.cookies.get(REMEMBERED_TEAM_COOKIE)?.value ?? null;
  // An explicit team switch must reach the membership picker, without the remembered team
  // being injected or sending the person back to Home.
  const teamSwitch = pathname === "/workspace" && request.nextUrl.searchParams.has("next");
  const needsTeams = pageRequest && !teamSwitch && (isTeamId(opened) || TEAM_SCOPED_PAGES.has(pathname));
  // null: not read (or unreadable), so nothing is remembered and nobody is redirected on a guess.
  let memberTeams: string[] | null = null;

  if (!isPendingWorkspacePath(pathname)) {
    const requestedOrg = await requestedProvisioningTeam(request, remembered);
    // One transaction for both reads: this runs on nearly every page load.
    const gate = await withRls({ userId: session.user.id, ...(requestedOrg ? { orgId: requestedOrg } : {}) },
      async client => ({
        pendingOrg: await pendingProvisioningTeam(client, session.user.id, requestedOrg),
        teams: needsTeams ? await memberTeamIds(client, session.user.id) : null,
      }));
    if (gate.pendingOrg) {
      const setup = `/team-setup?orgId=${encodeURIComponent(gate.pendingOrg)}`;
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Your team setup must finish before this action is available.", code: "TEAM_SETUP_REQUIRED", setup }, { status: 409, headers: { "cache-control": "private, no-store" } });
      return NextResponse.redirect(new URL(setup, request.url), 307);
    }
    memberTeams = gate.teams;
  } else if (needsTeams && isTeamId(opened) && opened !== remembered) {
    // Account, Help and the other while-you-wait pages: only asked when there is a team to remember.
    memberTeams = await withRls({ userId: session.user.id }, client => memberTeamIds(client, session.user.id)).catch(() => null);
  }

  // Remember the team a page was opened for, and fill it in for team pages that arrive
  // without one. Pages still check membership themselves.
  if (pageRequest) {
    if (teamSwitch) return NextResponse.next();
    const openedTeam = isTeamId(opened) ? opened : null;
    const notOnOpened = Boolean(openedTeam && memberTeams && !memberTeams.includes(openedTeam));
    // A link to someone else's team: say so on the chooser, with a way back to the person's own
    // team. Platform admin pages take any team id, and the while-you-wait pages have no team yet.
    if (notOnOpened && memberTeams?.length && !pathname.startsWith("/admin") && !isPendingWorkspacePath(pathname)) {
      return NextResponse.redirect(notOnTeamRedirect(new URL(request.url)), 307);
    }
    // /workspace was a second home page (event tiles, sync status, keyboard letters) that
    // every "Choose your team" link pointed at. A member goes to their team's Home.
    if (pathname === "/workspace" && memberTeams) {
      // The team they named, else the one they last used, else the one they run. The team
      // switcher (/workspace?next=…) is the chooser; this address is "take me to my team".
      const teamId = chooseMemberTeam(memberTeams, openedTeam, remembered);
      if (teamId) {
        const home = new URL("/dashboard", request.url);
        home.searchParams.set("orgId", teamId);
        return NextResponse.redirect(home, 307);
      }
    }
    if (openedTeam) {
      const response = NextResponse.next();
      // Never a team the person is not on, and never on a guess when the read failed.
      if (remembered !== openedTeam && memberTeams?.includes(openedTeam)) {
        response.cookies.set(REMEMBERED_TEAM_COOKIE, openedTeam, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        });
      }
      return response;
    }
    if (TEAM_SCOPED_PAGES.has(pathname) && memberTeams) {
      // A remembered team the person has since left (or never joined) falls back to their own.
      const target = teamPageRedirect(new URL(request.url), chooseMemberTeam(memberTeams, remembered));
      if (target) return NextResponse.redirect(target, 307);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)"],
};
