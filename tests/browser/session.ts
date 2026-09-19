import type { BrowserContext, Cookie } from "@playwright/test";
import { playwrightOrigin } from "./origin";

/**
 * Every spec used to hardcode `url: "http://localhost:3310"` on its auth cookie.
 * Run the suite against any other origin — a second dev server on a free port,
 * a preview deploy — and Playwright silently dropped the cookie, so the run
 * turned into a wall of "redirected to /signin" failures that looked like
 * product bugs. Derive the cookie origin from PLAYWRIGHT_BASE_URL / port.
 */
export function baseOrigin(): string {
  return playwrightOrigin();
}

type CookieSpec = Pick<Cookie, "name" | "value"> & Partial<Cookie>;

/** Add cookies scoped to whichever origin this run is pointed at. */
/**
 * The product tour, already taken.
 *
 * A freshly seeded account has never seen it, so the tour opens over the page
 * with a full-screen scrim and the first click of every signed-in spec hits
 * `button.tour-scrim` instead of the thing it asked for. That is the tour
 * working correctly and the test measuring the wrong thing.
 *
 * Keyed by version so bumping `TOUR_VERSION` shows it to real people again
 * without silently leaving the suite clicking through a scrim.
 */
const TOUR_DONE_KEY = "vantage.tour.v1";

async function dismissFirstRunOverlays(context: BrowserContext) {
  await context.addInitScript((key: string) => {
    try {
      window.localStorage.setItem(key, "done");
    } catch {
      // Private mode or blocked storage: the tour will show and the spec that
      // cares can close it. Not worth failing a run over.
    }
  }, TOUR_DONE_KEY);
}

export async function addSessionCookies(context: BrowserContext, cookies: CookieSpec[]) {
  await context.addCookies(
    cookies.map((cookie) => ({ sameSite: "Lax" as const, ...cookie, url: baseOrigin() })),
  );
  await dismissFirstRunOverlays(context);
}

/** The local E2E auth fixture session (`E2E_AUTH_FIXTURE=1`). */
export async function signInFixture(context: BrowserContext) {
  await addSessionCookies(context, [
    { name: "vantage-e2e-session", value: "authenticated", httpOnly: true },
  ]);
}

// ---------------------------------------------------------------------------
// Real Better Auth sessions
// ---------------------------------------------------------------------------

/**
 * `E2E_AUTH_FIXTURE` only walks the proxy past its auth check — it mints no
 * Better Auth session, so every `requireSession()` API route still answers 401
 * and the fixture can only ever assert on signed-out shells. Anything that
 * turns on *who* you are — a member answering a form, a non-admin being told
 * no — needs a real session.
 *
 * The defaults below are seeded into a throwaway local Postgres: four accounts
 * — an `owner`, a `scout`, one on no team at all, and a platform admin — each
 * with a credential row so the suite can sign in. The password is a fixture value that exists nowhere
 * but such a database. Point the suite at your own pair with the env vars.
 *
 *   VANTAGE_E2E_OWNER_EMAIL  / VANTAGE_E2E_OWNER_PASSWORD   (owner or admin)
 *   VANTAGE_E2E_MEMBER_EMAIL / VANTAGE_E2E_MEMBER_PASSWORD  (neither)
 *   VANTAGE_E2E_NOTEAM_EMAIL / VANTAGE_E2E_NOTEAM_PASSWORD  (signed in, no team)
 *   VANTAGE_E2E_PLATFORM_EMAIL / VANTAGE_E2E_PLATFORM_PASSWORD (platform admin)
 *
 * Nothing fails when they are absent — the tests that need them skip.
 */
export const LOCAL_FIXTURE_PASSWORD = "LocalE2EPassword123!";

export type FixtureRole = "owner" | "member" | "no-team" | "platform";

export function fixtureAccount(role: FixtureRole): { email: string; password: string } {
  const prefix =
    role === "owner"
      ? "VANTAGE_E2E_OWNER"
      : role === "member"
        ? "VANTAGE_E2E_MEMBER"
        : role === "platform"
          ? "VANTAGE_E2E_PLATFORM"
          : "VANTAGE_E2E_NOTEAM";
  return {
    email:
      process.env[`${prefix}_EMAIL`] ??
      (role === "owner"
        ? "e2e-owner@vantage.local"
        : role === "member"
          ? "e2e-member@vantage.local"
          : role === "platform"
            ? "e2e-platform@vantage.local"
            : "e2e-no-team@vantage.local"),
    password: process.env[`${prefix}_PASSWORD`] ?? LOCAL_FIXTURE_PASSWORD,
  };
}

/**
 * Better Auth rate-limits to 20 requests a minute, so a suite that signed in
 * inside every test would start failing with 429s that look like product bugs.
 * One sign-in per account per run, reused as a cookie value.
 */
const cookieCache = new Map<string, string | null>();

async function fetchSessionCookie(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<string | null> {
  const response = await context.request.post(`${baseOrigin()}/api/auth/sign-in/email`, {
    // Better Auth rejects a same-origin POST with no Origin header outright.
    headers: { "content-type": "application/json", origin: baseOrigin() },
    data: { email, password },
    failOnStatusCode: false,
  });
  if (!response.ok()) return null;
  /**
   * `cookies(url)` first, then the whole jar.
   *
   * Better Auth marks the session cookie `Secure` when it is running in
   * production mode. Chromium treats 127.0.0.1 as a trustworthy origin and
   * sends such a cookie over plain http anyway, but Playwright's URL filter
   * does not make that exception — so against a `next start` build the jar
   * held a perfectly good session and this returned null, `signInAs` reported
   * false, and every signed-in spec skipped. A suite that skips itself is
   * worse than one that fails: it reports success.
   *
   * The fallback is scoped to this origin's host, so it cannot pick up a
   * cookie belonging to somewhere else.
   */
  const host = new URL(baseOrigin()).hostname;
  // The whole jar, filtered by host — not `cookies(url)`, and not "fall back
  // to the jar if the url query came back empty" either: the url query does
  // return cookies here, just not the Secure one, so a length check on it
  // never reaches the fallback. The session cookie is the thing being looked
  // for, so look for it everywhere this origin's host could have put it.
  const jar = await context.cookies();
  return (
    jar.find(
      (cookie) =>
        cookie.name.includes("session_token") &&
        (cookie.domain === host || cookie.domain === `.${host}`),
    )?.value ?? null
  );
}

/**
 * Put a real session for `role` on this context, or return false when the
 * environment has no such account. Callers skip rather than fail: a box with
 * no seeded database is not a product defect.
 */
export async function signInAs(context: BrowserContext, role: FixtureRole): Promise<boolean> {
  const { email, password } = fixtureAccount(role);
  if (!cookieCache.has(email)) {
    try {
      cookieCache.set(email, await fetchSessionCookie(context, email, password));
    } catch {
      // Next crashed or is still booting. Do not cache the miss — the next
      // test can retry, and callers still fall back to the fixture cookie.
      return false;
    }
  }
  const value = cookieCache.get(email) ?? null;
  if (!value) return false;
  await addSessionCookies(context, [
    { name: "better-auth.session_token", value, httpOnly: true },
  ]);
  return true;
}
