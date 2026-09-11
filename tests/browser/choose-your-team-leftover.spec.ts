import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("All apps team chip and Chat empty say Choose your team", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.locator("body")).not.toContainText("Application error");

  await page.getByRole("button", { name: "Open all apps" }).click();
  const drawer = page.getByRole("complementary", { name: "Product navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer).not.toContainText("Pick a team");

  await page.goto("/messages");
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Pick a team");
  const choose = page.getByRole("heading", { name: "Choose your team", exact: true });
  const channels = page.getByText("Channels", { exact: true });
  await expect(choose.or(channels)).toBeVisible();
  if (await choose.isVisible()) {
    await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
    await expect(page.getByText("Choose your team to open chat.")).toBeVisible();
  }
});
