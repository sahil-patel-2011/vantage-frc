import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Alliance, Team admin, Help, and Attendance drop leftover engineering copy", async ({ page }) => {
  await page.goto("/strategy/draft");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("org-bound")).toHaveCount(0);
  await expect(page.getByText("team_event_metrics")).toHaveCount(0);
  await expect(page.getByText("membership-bound")).toHaveCount(0);

  await page.goto("/strategy/board");
  await expect(page.getByRole("heading", { name: /Could not load draft board|Alliance board/i })).toBeVisible();
  await expect(page.getByText("org-bound")).toHaveCount(0);
  await expect(page.getByText("mentor token")).toHaveCount(0);
  await expect(page.getByText("share token")).toHaveCount(0);

  await page.goto("/strategy?tab=picks");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("org-bound")).toHaveCount(0);
  await expect(page.getByText("team_event_metrics")).toHaveCount(0);
  await expect(page.getByText("membership-bound")).toHaveCount(0);

  await page.goto("/team/admin");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("token hard limits")).toHaveCount(0);
  await expect(page.getByText("API-key powers")).toHaveCount(0);

  await page.goto("/help/getting-started");
  await expect(page.getByRole("heading", { name: "Set up a new team, start to first event" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Permalink" })).toHaveCount(0);

  await page.goto("/attendance");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("workspace members")).toHaveCount(0);
});
