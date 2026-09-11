import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Research is a student lookup, not an engineering wall", async ({ page }) => {
  await page.goto("/intel");
  await waitForLoadingGone(page);
  await expect(page.getByRole("heading", { level: 1, name: "Research" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await expect(page.getByText("global team index")).toHaveCount(0);
  await expect(page.getByText("Statbotics")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toBeVisible();
  if (await page.getByRole("heading", { name: "Look up a team" }).isVisible()) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
  }
  await page.screenshot({ path: "/opt/cursor/artifacts/intel-after-shell.png", fullPage: true });
});

test("Overnight brief keeps one primary and related in the header", async ({ page }) => {
  await page.goto("/overnight-intel");
  await waitForLoadingGone(page);
  await expect(page.getByRole("heading", { level: 1, name: "Overnight brief" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await expect(page.getByText("Grounding path")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/overnight-brief-shell.png", fullPage: true });
});
