import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

const SHELLS = ["/competition", "/packing", "/batteries", "/pit", "/command"] as const;

/**
 * Production `next start` offline reload for the event shells.
 * Skips without a seeded owner — the fixture cookie is not a session.
 */
test.describe("signed-in offline shells", () => {
  test("packing, batteries, pit, competition, and Event Day survive going offline", async ({
    page,
    context,
  }) => {
    const signed = await signInAs(context, "owner");
    test.skip(!signed, "needs a seeded owner (VANTAGE_E2E_OWNER_EMAIL / _PASSWORD)");
    for (const route of SHELLS) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await expect(page).not.toHaveURL(/\/signin/);
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/something went wrong/i);
      await context.setOffline(false);
    }
  });
});
