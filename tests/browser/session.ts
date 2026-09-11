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
 * The defaults below are seeded into a throwaway local Postgres: two accounts
 * in one workspace, one `owner` and one `scout`, both with a credential row so
 * the suite can sign in. The password is a fixture value that exists nowhere
 * but such a database. Point the suite at your own pair with the env vars.
 *
 *   VANTAGE_E2E_OWNER_EMAIL  / VANTAGE_E2E_OWNER_PASSWORD   (owner or admin)
 *   VANTAGE_E2E_MEMBER_EMAIL / VANTAGE_E2E_MEMBER_PASSWORD  (neither)
 *
 * Nothing fails when they are absent — the tests that need them skip.
 */
export const LOCAL_FIXTURE_PASSWORD = "LocalE2EPassword123!";

export type FixtureRole = "owner" | "member";

export function fixtureAccount(role: FixtureRole): { email: string; password: string } {
  const prefix = role === "owner" ? "VANTAGE_E2E_OWNER" : "VANTAGE_E2E_MEMBER";
  return {
    email:
      process.env[`${prefix}_EMAIL`] ??
      (role === "owner" ? "e2e-owner@vantage.local" : "e2e-member@vantage.local"),
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
  const cookies = await context.cookies(baseOrigin());
  return cookies.find((cookie) => cookie.name.includes("session_token"))?.value ?? null;
}

/**
 * Put a real session for `role` on this context, or return false when the
 * environment has no such account. Callers skip rather than fail: a box with
 * no seeded database is not a product defect.
 */
export async function signInAs(context: BrowserContext, role: FixtureRole): Promise<boolean> {
  const { email, password } = fixtureAccount(role);
  if (!cookieCache.has(email)) {
    cookieCache.set(email, await fetchSessionCookie(context, email, password));
  }
  const value = cookieCache.get(email) ?? null;
  if (!value) return false;
  await addSessionCookies(context, [
    { name: "better-auth.session_token", value, httpOnly: true },
  ]);
  return true;
}
