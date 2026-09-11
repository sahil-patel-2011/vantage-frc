import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Account, Pair VS Code, and leftover no-org gates stay student-usable", async ({ page }) => {
  await page.goto("/showcase");
  await expect(page.getByRole("heading", { name: "Showcase" })).toBeVisible();
  await expect(page.getByText("pick the team first")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Choose your team" })).toHaveCount(1);

  await page.goto("/team/prompts");
  await expect(page.getByRole("heading", { name: "Prompts" })).toBeVisible();
  await expect(page.getByText("pick the team first")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Choose your team" })).toHaveCount(1);

  await page.goto("/team/getting-started");
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
  await expect(page.getByText("pick the team first")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Choose your team" })).toHaveCount(1);

  await page.goto("/editor/pair");
  await expect(page.getByRole("heading", { name: "Pair VS Code" })).toBeVisible();
  await expect(page.getByText("Organization / workspace")).toHaveCount(0);

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No team selected" })).toHaveCount(0);
});
