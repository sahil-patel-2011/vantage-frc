import { auth, isEmail2faEnforced, isOnboardingComplete, sessionHasEmail2fa } from "@vantage/core";
import { withRls } from "@vantage/db";
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = new Set([
  "/",
  "/features",
  "/features/cad",
  "/features/strategy",
  "/features/code",
  "/workflow",
  "/pricing",
  "/privacy",
  "/terms",
  "/signin",
  "/sign-in",
]);
const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/waitlist",
  "/api/admin/bootstrap-owner",
  "/api/showcase/public",
  "/api/display/snapshot",
  "/api/strategy/draft/public",
  "/api/partner-placements",
  "/api/partner-assets",
  "/api/support",
  "/support",
  "/showcase/present",
  "/strategy/board",
  "/display/kiosk",
  // CAD desktop CLI: pairing codes + device-token relay (no session cookie).
  "/api/cad/pair/start",
  "/api/cad/pair/poll",
  "/api/cad/relay",
  "/api/cad/compatibility",
  // Generated social/SEO images must be crawlable without auth.
  "/opengraph-image",
  "/twitter-image",
];
const PUBLIC_FILE = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?|xml)$/i;

function isPublic(pathname: string) {
  return (
    PUBLIC_PAGES.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    PUBLIC_FILE.test(pathname)
  );
}

function signInRedirect(request: NextRequest) {
  const signIn = new URL("/signin", request.url);
  signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signIn);
}

function safeRelativePath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
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
  return NextResponse.redirect(new URL(safeRelativePath(next), request.url));
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

  let onboardingDone = true;
  try {
    onboardingDone = await withRls({ userId: session.user.id }, (client) =>
      isOnboardingComplete(client, session.user.id),
    );
  } catch {
    onboardingDone = false;
  }

  if (!onboardingDone) {
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

  if (pathname === "/signin" || pathname === "/sign-in" || pathname === "/onboarding") {
    return postOnboardingRedirect(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
