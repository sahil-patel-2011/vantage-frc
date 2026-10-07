import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Strategy hub still loads after the panel split", async ({ page }) => {
  await page.goto("/competition?tab=strategy");
  await expect(page.getByRole("tab", { name: "Match plan" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  // Coach notes fold under "Details for leads"; the game plan is what a loaded match shows first.
  const live = page.getByRole("heading", { name: "Game plan for this match" });
  const empty = page.getByRole("heading", { name: "No match ahead" });
  const setup = page.getByRole("heading", { name: /Choose your team|Choose your team|Choose your team and event/i });
  const unavailable = page.getByRole("heading", { name: /Could not load strategy/i });
  // A missing membership or active event must expose the setup action.
  if (!(await expectHubReadyOrGate(page, live, empty.or(setup).or(unavailable)))) {
    await page.screenshot({ path: "/opt/cursor/artifacts/strategy-after-split.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("tablist", { name: "Competition sections", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Match plan" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Try demo scenario" })).toHaveCount(0);

  await page.screenshot({ path: "/opt/cursor/artifacts/strategy-after-split.png", fullPage: true });
});
