import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Team admin setup and leftover boards never say Join or pick a team", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/team/admin");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("main")).not.toContainText("Join or pick a team");
  await expect(page.locator("main")).not.toContainText("After you pick a team");
  await expect(page.getByRole("heading", { name: "Choose your team" })).toBeVisible();
  await expect(page.getByText("Choose your team before managing access")).toBeVisible();
  await expect(page.getByText("After you choose your team")).toBeVisible();

  for (const route of ["/retro", "/build-burndown", "/cross-team-scrim", "/editor/pair"]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("main")).not.toContainText("Join or pick a team");
  }
});
