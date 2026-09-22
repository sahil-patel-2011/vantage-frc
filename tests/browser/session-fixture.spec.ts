import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

/**
 * The canary for the whole signed-in suite.
 *
 * When the seeded logins are missing, `signInAs` returns false, every spec
 * falls back to a signed-out shell, and the run reports a wall of assertion
 * failures about headings and counts — none of which are about the code being
 * tested. This fails first and says what is actually wrong.
 */
test("the suite can sign in as a real seeded owner", async ({ context, page }) => {
  const signed = await signInAs(context, "owner");
  expect(
    signed,
    "Could not sign in as the seeded owner. Run scripts/seed-dev.mjs then scripts/seed-e2e-logins.mjs against the test database.",
  ).toBe(true);

  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(200);
  const body = (await me.json()) as { authenticated?: boolean; orgId?: string | null };
  // /api/me answers 200 when signed out too, so the body is the only real check.
  expect(body.authenticated, "/api/me reports signed out — the session cookie did not take").toBe(true);
  expect(body.orgId, "signed in, but the account has no team — seed-e2e-logins adds the membership").toBeTruthy();
});
