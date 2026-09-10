import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Alliance selection desk still loads after the Saturday shell pass", async ({ page }) => {
  await page.goto("/alliance-selection-desk");
  await expect(page.locator("body")).not.toContainText("Application error");

  const board = page.getByRole("heading", { name: /Alliance selection desk|Live alliance selection board/i });
  const setup = page.getByRole("heading", { name: /Choose your team|Choose your team/i });
  const empty = page.getByRole("heading", { name: /Create a selection desk session/i });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, board, empty.or(setup).or(unavailable)))) {
    await page.screenshot({ path: "/opt/cursor/artifacts/alliance-desk-after-shell.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await page.screenshot({ path: "/opt/cursor/artifacts/alliance-desk-after-shell.png", fullPage: true });
});
