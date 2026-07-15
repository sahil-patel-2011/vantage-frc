import { auth } from "@vantage/core";
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = new Set(["/", "/features", "/features/cad", "/features/strategy", "/features/code", "/workflow", "/pricing", "/privacy", "/terms", "/signin", "/sign-in"]);
const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/waitlist",
  "/api/admin/bootstrap-owner",
  "/api/showcase/public",
  "/api/display/snapshot",
  "/showcase/present",
  "/display/kiosk",
];
const PUBLIC_FILE = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?|xml)$/i;

function isPublic(pathname: string) {
  return PUBLIC_PAGES.has(pathname)
    || PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    || PUBLIC_FILE.test(pathname);
}

function signInRedirect(request: NextRequest) {
  const signIn = new URL("/signin", request.url);
  signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signIn);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const fixtureSession = process.env.NODE_ENV !== "production"
    && process.env.E2E_AUTH_FIXTURE === "1"
    && request.cookies.get("vantage-e2e-session")?.value === "authenticated";

  if (isPublic(pathname) && pathname !== "/signin") {
    return NextResponse.next();
  }

  let authenticated = Boolean(fixtureSession);
  if (!authenticated && getSessionCookie(request)) {
    try {
      authenticated = Boolean(await auth.api.getSession({ headers: request.headers }));
    } catch {
      authenticated = false;
    }
  }

  if (pathname === "/signin") {
    return authenticated ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
  }

  return authenticated ? NextResponse.next() : signInRedirect(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
