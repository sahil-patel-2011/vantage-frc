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
  const setup = page.getByRole("heading", { name: "Select a team" });
  // GHA has no Postgres: HubOrgGate paints Choose a team and never mounts KickoffClient.
  if (!(await expectHubReadyOrGate(page, intel, setup))) {
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
