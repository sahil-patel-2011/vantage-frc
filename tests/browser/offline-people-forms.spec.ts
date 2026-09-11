import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test.describe("offline student people and remaining form leaves", () => {
  test.beforeEach(async ({ context }) => {
    await signInFixture(context);
  });

  test("Alumni still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/team/alumni");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Bus-Factor still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/bus-factor");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Driver Tryouts still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/driver-tryouts");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Skills & Mentorship still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/skills-graph");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Safety Training still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/safety-training");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Scout forms still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/scouting/forms");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });
});
