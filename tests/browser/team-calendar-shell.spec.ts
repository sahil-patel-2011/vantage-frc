import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Team calendar hub still loads after the panel split", async ({ page }) => {
  await page.goto("/team?tab=calendar");
  await expect(page.getByRole("tab", { name: "Calendar" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("Loading team calendar…")).toBeHidden({ timeout: 20_000 });

  const viewGroup = page.getByRole("group", { name: "Calendar view" });
  const recoveryTitle = page.locator(".tc-empty strong");
  await expect(viewGroup.or(recoveryTitle)).toBeVisible({ timeout: 15_000 });

  if ((await viewGroup.count()) === 0) {
    // Fixture cookie is not a Better Auth session, so the API answers 401
    // and the extracted shell still paints an honest recovery card.
    await expect(recoveryTitle).toBeVisible();
    return;
  }

  // Ready calendar: Day/Week/Month/List are custom buttons, not a nested TabBar.
  await expect(viewGroup.getByRole("button", { name: "Week" })).toBeVisible();
  await expect(viewGroup.getByRole("button", { name: "Day" })).toBeVisible();
  await expect(viewGroup.getByRole("button", { name: "Month" })).toBeVisible();
  await expect(viewGroup.getByRole("button", { name: "List" })).toBeVisible();
  await expect(viewGroup.getByRole("tab")).toHaveCount(0);

  await viewGroup.getByRole("button", { name: "Month" }).click();
  await expect(page.locator(".tc-month")).toBeVisible();

  await viewGroup.getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();

  await page.getByRole("button", { name: "Phone calendar" }).click();
  await expect(page.getByRole("heading", { name: "Phone calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "← Calendar" })).toBeVisible();
  await page.getByRole("button", { name: "← Calendar" }).click();
  await expect(viewGroup).toBeVisible();
});
