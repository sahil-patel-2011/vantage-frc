import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Match strategy cards still loads after the Saturday shell pass", async ({ page }) => {
  await page.goto("/match-strategy-cards");
  await expect(page.locator("body")).not.toContainText("Application error");

  const board = page.getByRole("heading", { name: /Match strategy cards|Printable per-match game plans/i });
  const setup = page.getByRole("heading", { name: /Choose your team|Choose your team/i });
  const empty = page.getByRole("heading", { name: /Waiting on a synced match schedule/i });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, board, empty.or(setup).or(unavailable)))) {
    await page.screenshot({ path: "/opt/cursor/artifacts/match-strategy-cards-after-shell.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await page.screenshot({ path: "/opt/cursor/artifacts/match-strategy-cards-after-shell.png", fullPage: true });
});
