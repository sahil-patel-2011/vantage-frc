import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Kickoff hub still loads after the panel split", async ({ page }) => {
  await page.goto("/build?tab=kickoff");
  await expect(page.getByRole("tab", { name: "Kickoff" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const intel = page.getByRole("heading", { name: "Game release intelligence" });
  const settledEmpty = page.locator(".kick-page .soft-empty:not([aria-busy='true'])");
  const opening = page.getByRole("heading", { name: "Opening your team" });

  await expect(opening).toHaveCount(0, { timeout: 20_000 });
  if (!(await expectHubReadyOrGate(page, intel, settledEmpty))) {
    if (process.env.KICKOFF_SHOT === "1") {
      await page.screenshot({ path: "/opt/cursor/artifacts/kickoff-after-split.png", fullPage: true });
    }
    return;
  }

  await expect(page.getByRole("heading", { name: "Scoring analysis" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Design priorities" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Kickoff" })).toHaveAttribute("aria-selected", "true");

  if (process.env.KICKOFF_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/kickoff-after-split.png", fullPage: true });
  }
});
