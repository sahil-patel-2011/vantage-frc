import { expect, test } from "@playwright/test";
import { gotoReady } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Account, Pair VS Code, and leftover no-org gates stay student-usable", async ({ page }) => {
  await gotoReady(page, "/showcase");
  await expect(page.getByRole("heading", { name: "Showcase" })).toBeVisible();
  await expect(page.getByText("pick the team first")).toHaveCount(0);
  // Signed-in members land on their team; only someone with no team sees the chooser.
  expect(await page.getByRole("link", { name: "Choose your team" }).count()).toBeLessThanOrEqual(1);

  await gotoReady(page, "/team/prompts");
  await expect(
    page
      .getByRole("heading", { name: "Prompts" })
      .or(page.getByRole("heading", { name: "Choose your team" }))
      .first(),
  ).toBeVisible();
  await expect(page.getByText("pick the team first")).toHaveCount(0);

  await gotoReady(page, "/team/getting-started");
  await expect(page.getByRole("heading", { level: 1, name: /Getting started|Team setup/ })).toBeVisible();
  await expect(page.getByText("pick the team first")).toHaveCount(0);
  expect(await page.getByRole("link", { name: "Choose your team" }).count()).toBeLessThanOrEqual(1);

  await page.goto("/editor/pair");
  await expect(page.getByRole("heading", { name: "Pair VS Code" })).toBeVisible();
  await expect(page.getByText("Organization / workspace")).toHaveCount(0);

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No team selected" })).toHaveCount(0);
});
