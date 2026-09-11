import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Scout Accuracy, Data impact, Lineup, and Match video drop membership-bound", async ({
  page,
}) => {
  await page.goto("/scout-accuracy");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("membership-bound")).toHaveCount(0);
  await expect(page.getByText("pick-desk ready")).toHaveCount(0);

  await page.goto("/scout-data-impact");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("membership-bound")).toHaveCount(0);

  await page.goto("/scouting/lineup");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("membership-bound")).toHaveCount(0);
  await expect(page.getByText("membership IDs")).toHaveCount(0);

  await page.goto("/video");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("membership-bound")).toHaveCount(0);
});
