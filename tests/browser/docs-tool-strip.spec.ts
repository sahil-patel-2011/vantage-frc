import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

test("docs manual views and season moments are a tool strip, not a tab bar", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "App manual" })).toBeVisible();

  const views = page.getByRole("navigation", { name: "Manual views" });
  await expect(views).toBeVisible();
  await expect(page.getByRole("tab", { name: "Topics" })).toHaveCount(0);
  await expect(views.getByRole("button", { name: "Topics" })).toHaveAttribute("aria-current", "page");
  await expect(views.getByRole("button", { name: "Section by section" })).toBeVisible();

  await views.getByRole("button", { name: "Section by section" }).click();
  await expect(page.getByRole("heading", { name: "How Vantage works, section by section" })).toBeVisible();

  const moments = page.getByRole("navigation", { name: "Season moment" });
  await expect(moments.getByRole("button", { name: "All season" })).toHaveAttribute("aria-current", "page");
  await expect(moments.getByRole("button", { name: "Competition day" })).toBeVisible();
  await moments.getByRole("button", { name: "Competition day" }).click();
  await expect(page.locator(".section-guide-count")).toContainText("Between matches, in the pit and the stands.");
  await expect(moments.getByRole("button", { name: "Competition day" })).toHaveAttribute("aria-current", "page");
});
