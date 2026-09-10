import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test.describe("offline Competition hub", () => {
  test.beforeEach(async ({ context }) => {
    await signInFixture(context);
  });

  test("Competition still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/competition");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Season calendar still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });
});
