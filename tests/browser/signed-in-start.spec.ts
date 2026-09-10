import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

/**
 * Real Better Auth session against a running server (typically `next start`).
 * Skips when the environment has no seeded owner — the fixture cookie is not
 * a session and must not be treated as one.
 */
test.describe("signed-in product shell", () => {
  test("Home and Admin load for a seeded owner without a 500", async ({ page, context }) => {
    const signed = await signInAs(context, "owner");
    test.skip(!signed, "needs a seeded owner (VANTAGE_E2E_OWNER_EMAIL / _PASSWORD)");
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).not.toHaveURL(/\/signin/);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).not.toHaveURL(/\/signin/);
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await expect(page.locator("body")).not.toContainText("404");
    await page.goto("/connectors");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).not.toHaveURL(/\/signin/);
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
  });
});
