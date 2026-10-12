import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("account sections are Settings sections, and Notifications opens its preferences", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/account");
  // /account is Settings › Profile; the Settings list beside it switches sections.
  await expect(page.getByRole("heading", { level: 1, name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loading account" })).toBeHidden({ timeout: 20_000 });

  const sections = page.getByRole("navigation", { name: "Settings sections", exact: true });
  await expect(sections).toBeVisible();
  await expect(sections.getByRole("link", { name: "Profile", exact: true })).toHaveAttribute("aria-current", "page");
  await sections.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(page).toHaveURL(/\/notifications\/preferences/, { timeout: 20_000 });
});
