import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Scouting hub still loads after the panel split", async ({ page }) => {
  await page.goto("/competition?tab=scouting");
  await expect(page.getByRole("tab", { name: "Scouting" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const views = page.getByRole("navigation", { name: "Scouting views" });
  const recovery = page.locator(".scout-shell-empty");
  if (!(await expectHubReadyOrGate(page, views, recovery))) return;

  await expect(views.getByRole("button", { name: "Match" })).toBeVisible();
  await expect(views.getByRole("button", { name: "Pit" })).toBeVisible();
  await expect(views.getByRole("tab")).toHaveCount(0);

  await views.getByRole("button", { name: "Pit" }).click();
  await expect(views.getByRole("button", { name: "Pit" })).toHaveAttribute("aria-current", "page");
  await views.getByRole("button", { name: "Match" }).click();
});
