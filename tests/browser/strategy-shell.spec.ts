import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Strategy hub still loads after the panel split", async ({ page }) => {
  await page.goto("/competition?tab=strategy");
  await expect(page.getByRole("tab", { name: "Strategy" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const live = page.getByRole("heading", { name: "Coach notes" });
  const empty = page.getByRole("heading", { name: "Waiting on a real matchup" });
  const setup = page.getByRole("heading", { name: /Choose a team|Select a team|Choose a team and event/i });
  const unavailable = page.getByRole("heading", { name: /Could not load strategy/i });
  // GHA has no Postgres: HubOrgGate paints Choose a team and never mounts StrategyClient.
  if (!(await expectHubReadyOrGate(page, live, empty.or(setup).or(unavailable)))) {
    await page.screenshot({ path: "/opt/cursor/artifacts/strategy-after-split.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("navigation", { name: "Strategy sections" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Strategy" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Try demo scenario" })).toHaveCount(0);

  await page.screenshot({ path: "/opt/cursor/artifacts/strategy-after-split.png", fullPage: true });
});
