import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Security, Bring your season, and Media shells stay student-usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/migrate");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("main")).not.toContainText("Workspace required");
  await expect(page.locator("main")).not.toContainText("Pick a team first");
  await expect(page.locator("main")).not.toContainText("switching kit");

  await page.goto("/team/security");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("main")).not.toContainText("pick the team first");
  await expect(page.getByRole("heading", { name: "Choose your team" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Choose your team" })).toHaveCount(1);

  await page.goto("/media");
  await expect(page.locator("body")).not.toContainText("Application error");
  const sections = page.getByRole("navigation", { name: "Media sections" });
  if (await sections.isVisible()) {
    await expect(sections.getByRole("tab")).toHaveCount(0);
  } else {
    await expect(page.getByRole("tab")).toHaveCount(0);
  }
});
