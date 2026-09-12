import { expect, test } from "@playwright/test";
import { assertNoTbaStatbotics } from "./leftover-tba-statbotics-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Pre-match briefing drops FMEA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await assertNoTbaStatbotics(
    page,
    "/briefing",
    /Pre-match briefing|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("Open FMEA risks");
  await expect(page.locator("body")).not.toContainText("RPN ");
});

test("leftover Match Copilot drops FMEA student copy", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/match-copilot");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Briefing|Choose your team|Needs setup|Your session ended|Sign in/i,
  );
  await expect(page.locator("body")).not.toContainText("Match Copilot");
  await expect(page.locator("body")).not.toContainText("TBA/Statbotics");
  await expect(page.locator("body")).not.toContainText("Season EPA");
  await expect(page.locator("body")).not.toContainText("Open FMEA risks");
  await expect(page.locator("body")).not.toContainText("RPN ");
});
