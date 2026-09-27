import { expect, test } from "@playwright/test";

test("the cost page distinguishes free Vantage from personal Codex and provider costs", async ({ page }) => {
  await page.goto("/pricing");
  // The plan ladder (Free / Pro / Pro+ / Max) is no longer offered. The page has one job:
  // say that Vantage costs nothing, and how AI works without Vantage charging for it.
  await expect(
    page.getByRole("heading", { level: 1, name: "Free for every team. Connect your own AI." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "How AI keys work" })).toBeVisible();
  await expect(page.getByText("Get a key", { exact: true })).toBeVisible();
  await expect(page.getByText("Paste it once", { exact: true })).toBeVisible();
  await expect(page.getByText("Set a limit", { exact: true })).toBeVisible();
  await expect(page.getByText("Or connect personal Codex", { exact: true })).toBeVisible();
  await expect(page.locator(".pricing-hero")).toContainText("no subscription charge");
  await expect(page.locator(".pricing-hero")).toContainText("External providers set their own prices and usage limits");
  await expect(page.getByText("Will it stay free?")).toBeVisible();

  // No tiers, prices or credit packs anywhere on the page.
  for (const gone of ["Pro+", "$20", "$60", "$100", "Buy AI credits"]) {
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("link", { name: "Join the waitlist" }).first()).toBeVisible();
});
