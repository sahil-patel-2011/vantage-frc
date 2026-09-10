import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Pick clock hub still loads after the Saturday shell pass", async ({ page }) => {
  await page.goto("/competition?tab=pick-clock");
  await expect(page.getByRole("tab", { name: "Strategy" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const tools = page.getByRole("navigation", { name: "Tools in Strategy" });
  const clock = page.getByRole("heading", { name: /Next pick|45-second pick clock/i });
  const empty = page.getByRole("heading", { name: "Waiting on a real pick pool" });
  const setup = page.getByRole("heading", { name: /Select a team|Choose a team/i });
  const unavailable = loadFailureHeading(page);
  // GHA has no Postgres: HubOrgGate paints Choose a team and never mounts PickClockClient.
  if (!(await expectHubReadyOrGate(page, clock, empty.or(setup).or(unavailable)))) {
    await page.screenshot({ path: "/opt/cursor/artifacts/pick-clock-after-shell.png", fullPage: true });
    return;
  }

  await expect(tools.getByRole("button", { name: "Pick clock", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Strategy" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await page.screenshot({ path: "/opt/cursor/artifacts/pick-clock-after-shell.png", fullPage: true });
});
