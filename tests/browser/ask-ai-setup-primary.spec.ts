import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Ask AI usage setup keeps one Choose your team primary", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/team/usage");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("main")).not.toContainText("pick a team first");
  await expect(page.locator("main")).not.toContainText("Pick a team first");
  await expect(page.getByRole("heading", { name: "Choose your team" })).toBeVisible();
  const choose = page.locator("main").getByRole("link", { name: "Choose your team" });
  await expect(choose).toHaveCount(1);
  await expect(choose).toHaveAttribute("href", "/workspace");

  // The related rail sits outside the setup card on purpose (26aa527), so these
  // destinations are present. What must not come back is a second copy of one,
  // or a second primary competing with Choose your team.
  for (const label of ["Account", "Pricing", "Chat"]) {
    await expect(page.locator("main").getByRole("link", { name: label, exact: true })).toHaveCount(
      1,
    );
  }
  await expect(page.locator("main").locator("a.is-primary, button.is-primary")).toHaveCount(1);
});
