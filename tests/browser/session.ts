import type { BrowserContext, Cookie } from "@playwright/test";

/**
 * Every spec used to hardcode `url: "http://localhost:3310"` on its auth cookie.
 * Run the suite against any other origin — a second dev server on a free port,
 * a preview deploy — and Playwright silently dropped the cookie, so the run
 * turned into a wall of "redirected to /signin" failures that looked like
 * product bugs. Derive the cookie origin from the config's baseURL instead.
 */
export function baseOrigin(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3310";
}

type CookieSpec = Pick<Cookie, "name" | "value"> & Partial<Cookie>;

/** Add cookies scoped to whichever origin this run is pointed at. */
export async function addSessionCookies(context: BrowserContext, cookies: CookieSpec[]) {
  await context.addCookies(
    cookies.map((cookie) => ({ sameSite: "Lax" as const, ...cookie, url: baseOrigin() })),
  );
}

/** The local E2E auth fixture session (`E2E_AUTH_FIXTURE=1`). */
export async function signInFixture(context: BrowserContext) {
  await addSessionCookies(context, [
    { name: "vantage-e2e-session", value: "authenticated", httpOnly: true },
  ]);
}
