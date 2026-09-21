import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * A team's TinyFish key: saved through the real form, checked with TinyFish
 * before it is stored, and never handed back.
 *
 * The same blunt check as the model-key spec: save a key, then assert it
 * appears in no response and nowhere on the page — including the parts of the
 * payload nobody thought about. A leak here is silent and total; the page would
 * look exactly the same.
 *
 * The accepted-key test needs a real key, because saving one calls TinyFish to
 * verify it. It reads TINYFISH_TEST_KEY and skips without it, so no secret
 * lives in the repository. The rejected-key test needs nothing: TinyFish
 * refusing a made-up key is the behaviour under test.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

const card = (page: import("@playwright/test").Page) => page.locator("section.ai-keys-web");

async function removeKey(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    await fetch("/api/organizations/tool-keys", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
  });
}

test("a made-up key is refused by TinyFish, with a sentence that says what to do", async ({ page }) => {
  await gotoAsTeam(page, "/team/ai-keys");
  const section = card(page);
  await expect(section).toBeVisible({ timeout: 25_000 });
  await removeKey(page);
  await page.reload();

  await section.getByLabel(/TinyFish API key/).fill("sk-tinyfish-thisisnotarealkeyatall1234");
  await section.getByRole("button", { name: /Check & save/ }).click();

  await expect(section.getByRole("status")).toContainText(/did not accept that key/i, { timeout: 30_000 });
  // Refused means not stored.
  await expect(section.locator(".ai-keys-status")).toHaveText("Not set up");
});

test("something that is not a TinyFish key is caught before it leaves the page", async ({ page }) => {
  await gotoAsTeam(page, "/team/ai-keys");
  const section = card(page);
  await expect(section).toBeVisible({ timeout: 25_000 });

  // An OpenAI key pasted into the wrong box is the likeliest mistake.
  await section.getByLabel(/TinyFish API key|Replace TinyFish key/).fill("sk-proj-abcdefghijklmnopqrstuvwxyz0123");
  await section.getByRole("button", { name: /Check & (save|replace)/ }).click();
  await expect(section.getByRole("status")).toContainText(/start with sk-tinyfish-/i, { timeout: 20_000 });
});

test("a real key is accepted, shown only by its last four characters, and never returned", async ({ page }) => {
  const realKey = process.env.TINYFISH_TEST_KEY?.trim() ?? "";
  test.skip(!realKey, "set TINYFISH_TEST_KEY to run the accepted-key path");

  await gotoAsTeam(page, "/team/ai-keys");
  const orgId = new URLSearchParams(new URL(page.url()).search).get("orgId");
  test.skip(!orgId, "no active org");
  const section = card(page);
  await expect(section).toBeVisible({ timeout: 25_000 });
  await removeKey(page);
  await page.reload();

  // Watch every response for the rest of the test.
  const leaks: string[] = [];
  const secretTail = realKey.slice(-12);
  page.on("response", async (response) => {
    try {
      const text = await response.text();
      if (text.includes(realKey) || text.includes(secretTail)) leaks.push(response.url());
    } catch {
      // Bodies of redirects and aborted requests cannot be read.
    }
  });

  await section.getByLabel(/TinyFish API key/).fill(realKey);
  await section.getByRole("button", { name: /Check & save/ }).click();

  await expect(section.getByRole("status")).toContainText(/TinyFish accepted the key/, { timeout: 30_000 });
  await expect(section.locator(".ai-keys-status")).toHaveText("Connected");
  await expect(section).toContainText(`Key ending in …${realKey.slice(-4)}`);
  // The box is cleared once the key is stored — a key left in a text field is
  // a key on screen for whoever walks past.
  await expect(section.getByLabel(/Replace TinyFish key/)).toHaveValue("");

  // Read back through every route that could plausibly carry it.
  for (const path of ["/api/organizations/tool-keys", "/api/organizations/ai-keys", "/api/me"]) {
    const body = await page.evaluate(
      async ([url, org]) => (await fetch(`${url}?orgId=${org}`, { cache: "no-store" })).text(),
      [path, orgId] as const,
    );
    expect(body, `${path} returned the key`).not.toContain(realKey);
    expect(body, `${path} returned part of the key`).not.toContain(secretTail);
  }

  await page.reload();
  await expect(page.locator("body")).not.toContainText(realKey, { timeout: 20_000 });
  expect(leaks, "a response carried the key").toEqual([]);

  // Remove it through the page, and the page agrees it is gone.
  await section.getByRole("button", { name: "Remove key" }).click();
  await expect(section.getByRole("status")).toContainText(/Key removed/, { timeout: 20_000 });
  await expect(section.locator(".ai-keys-status")).toHaveText("Not set up");
});
