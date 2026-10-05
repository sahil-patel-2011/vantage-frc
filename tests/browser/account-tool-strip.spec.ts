import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("account sections are visible tabs and notifications opens its preferences", async ({ page }) => {
  await page.goto("/account");
  // The page heading is "Account" — it holds both the "Your settings" and
  // "Team settings" groups, so naming it after one of them was wrong.
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loading account" })).toBeHidden({ timeout: 20_000 });

  const sections = page.getByRole("tablist", { name: "Account sections", exact: true });
  await expect(sections).toBeVisible();
  await expect(sections.getByRole("tab", { name: "Profile", exact: true })).toHaveAttribute("aria-selected", "true");
  await sections.getByRole("tab", { name: "Notifications", exact: true }).click();
  await expect(page).toHaveURL(/\/notifications\/preferences/, { timeout: 20_000 });
});
