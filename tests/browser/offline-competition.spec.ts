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

  test("My Day still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/my-day");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Event Day still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/command");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Packing still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/packing");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Batteries still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/batteries");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });

  test("Pit still renders after the tab goes offline", async ({ page, context }) => {
    await page.goto("/pit");
    await page.waitForLoadState("domcontentloaded");
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await context.setOffline(false);
  });
});
