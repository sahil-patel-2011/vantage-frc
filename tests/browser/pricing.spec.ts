import { expect, test } from "@playwright/test";

test("the cost page says it is free and that AI runs on the team's own key", async ({ page }) => {
  await page.goto("/pricing");
  // The plan ladder (Free / Pro / Pro+ / Max) is no longer offered. The page has one job:
  // say that Vantage costs nothing, and how AI works without Vantage charging for it.
  await expect(
    page.getByRole("heading", { level: 1, name: "Free for every team. Bring your own AI key." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "How AI keys work" })).toBeVisible();
  await expect(page.getByText("Get a key", { exact: true })).toBeVisible();
  await expect(page.getByText("Paste it once", { exact: true })).toBeVisible();
  await expect(page.getByText("Set a limit", { exact: true })).toBeVisible();
  await expect(page.getByText("Will it stay free?")).toBeVisible();

  // No tiers, prices or credit packs anywhere on the page.
  for (const gone of ["Pro+", "$20", "$60", "$100", "Buy AI credits"]) {
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("link", { name: "Join the waitlist" }).first()).toBeVisible();
});
