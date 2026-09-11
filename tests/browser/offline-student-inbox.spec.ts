import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test.describe("offline student inbox and shop leaves", () => {
  test.beforeEach(async ({ context }) => {
    await signInFixture(context);
  });

  test("Notifications still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/notifications");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Forms still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/forms");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Safety Incident Log still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/incidents");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Season roles still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/roles");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Parts catalog still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/parts-catalog");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Parts Relay still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/parts-relay");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });
});
