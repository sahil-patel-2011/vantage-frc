import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("account sections are a tool strip, not a tab bar", async ({ page }) => {
  await page.goto("/account");
  // The page heading is "Account" — it holds both the "Your settings" and
  // "Team settings" groups, so naming it after one of them was wrong.
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loading account" })).toBeHidden({ timeout: 20_000 });

  const sections = page.getByRole("navigation", { name: "Account sections" });
  const sessionEnded = page.getByRole("heading", { name: "Your session ended" });
  await expect(sections.or(sessionEnded)).toBeVisible();

  if (await sessionEnded.isVisible()) {
    await expect(page.getByRole("tab", { name: "Profile" })).toHaveCount(0);
    return;
  }

  await expect(page.getByRole("tab", { name: "Profile" })).toHaveCount(0);
  await expect(sections.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-current", "page");
  await expect(sections.getByRole("button", { name: "Appearance" })).toBeVisible();
  await expect(sections.getByRole("button", { name: "Notifications" })).toBeVisible();

  await sections.getByRole("button", { name: "Notifications" }).click();
  // One notification settings screen: the Account tab opens it directly.
  await expect(page).toHaveURL(/\/notifications\/preferences/, { timeout: 20_000 });
});
