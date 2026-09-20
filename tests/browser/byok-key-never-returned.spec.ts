import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * A key a team pastes in never comes back out.
 *
 * Provider keys are stored with envelope encryption — ciphertext, nonce, auth
 * tag, a wrapped data key and the KMS key id — and decrypted only on the
 * server, at the moment of a call. Reading the code says so. This checks it,
 * because the failure mode is silent and total: a response that includes the
 * key, or even the tail of it, hands a team's provider account to anyone who
 * opens developer tools, and nothing about the page would look different.
 *
 * The check is the blunt one on purpose. Rather than asserting the shape of
 * the response, it stores a key with a marker in it and then asserts that
 * marker appears in no response body at all — including the parts of the
 * payload nobody thought about, and the ones added later.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

/** Obvious nonsense, so a leak is unmistakable and nothing tries to use it. */
const MARKER = `NOT-A-REAL-KEY-${Date.now()}`;
const FAKE_KEY = `sk-vantage-spec-${MARKER}`;

const READ_BACK = [
  "/api/organizations/ai-keys",
  "/api/organizations/model-policy",
  "/api/me",
] as const;

test("a stored provider key is not in any response the browser can read", async ({ page }) => {
  await gotoAsTeam(page, "/team/ai-keys");
  const orgId = new URLSearchParams(new URL(page.url()).search).get("orgId");
  test.skip(!orgId, "no active org");

  const saved = await page.evaluate(
    async ([org, key]) => {
      const response = await fetch(`/api/organizations/ai-keys?orgId=${org}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: org, action: "save_key", provider: "openai", apiKey: key }),
      });
      return { ok: response.ok, body: await response.text() };
    },
    [orgId, FAKE_KEY] as const,
  );
  test.skip(!saved.ok, `could not store a key to test with: ${saved.body.slice(0, 160)}`);

  // The save's own reply is the first place it could come back.
  expect(saved.body, "the save response echoed the key").not.toContain(MARKER);

  for (const path of READ_BACK) {
    const body = await page.evaluate(
      async ([url, org]) => {
        const response = await fetch(`${url}?orgId=${org}`, { cache: "no-store" });
        return response.text();
      },
      [path, orgId] as const,
    );
    expect(body, `${path} returned the key`).not.toContain(MARKER);
    // The tail of a key is enough to confirm a guess, so no fragment either.
    expect(body, `${path} returned part of the key`).not.toContain(MARKER.slice(-12));
  }

  // And it is not sitting in the page for a screen-scrape either.
  await page.reload();
  await expect(page.locator("body")).not.toContainText(MARKER, { timeout: 20_000 });

  // The page must still say a key is configured — a leak-proof response that
  // also forgot the key would pass the checks above and break the feature.
  const status = await page.evaluate(
    async ([org]) => {
      const response = await fetch(`/api/organizations/ai-keys?orgId=${org}`, { cache: "no-store" });
      const json = (await response.json()) as { keys?: Array<{ provider: string; configured: boolean }> };
      return json.keys?.find((row) => row.provider === "openai")?.configured ?? false;
    },
    [orgId] as const,
  );
  expect(status, "the key was stored but the page does not know it").toBe(true);

  /*
    Put the workspace back — with the DELETE the page itself uses.

    This used to POST `save_key` with an empty string, which that route
    rejects with "API key is required". So the cleanup failed silently and
    every run of this spec left a fake OpenAI key on the fixture team, which
    then took priority over the free provider and quietly changed what the
    rest of the suite was exercising.
  */
  const removed = await page.evaluate(
    async ([org]) => {
      const response = await fetch(`/api/organizations/ai-keys?orgId=${org}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: org, provider: "openai" }),
      });
      return response.ok;
    },
    [orgId] as const,
  );
  expect(removed, "the spec could not remove the key it created").toBe(true);

  // And the page agrees it is gone, which is the other half of a key's life.
  const stillThere = await page.evaluate(
    async ([org]) => {
      const response = await fetch(`/api/organizations/ai-keys?orgId=${org}`, { cache: "no-store" });
      const json = (await response.json()) as { keys?: Array<{ provider: string; configured: boolean }> };
      return json.keys?.find((row) => row.provider === "openai")?.configured ?? false;
    },
    [orgId] as const,
  );
  expect(stillThere, "the key is still configured after removing it").toBe(false);
});
