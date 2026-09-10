import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("account sections are a tool strip, not a tab bar", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your settings" })).toBeVisible();

  const signedIn = await page.getByRole("navigation", { name: "Account sections" }).count();
  if (signedIn === 0) {
    await expect(page.getByRole("heading", { name: "Your session ended" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Profile" })).toHaveCount(0);
    return;
  }

  const sections = page.getByRole("navigation", { name: "Account sections" });
  await expect(sections).toBeVisible();
  await expect(page.getByRole("tab", { name: "Profile" })).toHaveCount(0);
  await expect(sections.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-current", "page");
  await expect(sections.getByRole("button", { name: "Appearance" })).toBeVisible();
  await expect(sections.getByRole("button", { name: "Notifications" })).toBeVisible();

  await sections.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { name: "In-app notifications" })).toBeVisible();
  await expect(sections.getByRole("button", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
});
