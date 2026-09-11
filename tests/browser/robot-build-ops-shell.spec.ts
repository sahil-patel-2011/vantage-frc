import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const LEAVES = [
  { path: "/power-budget", heading: "Power budget" },
  { path: "/shooter-table", heading: "Shooter table" },
  { path: "/subsystems", heading: "Subsystem specs" },
  { path: "/wiring", heading: "CAN-bus map" },
  { path: "/tuning", heading: "Tuning log" },
  { path: "/software-versions", heading: "Software versions" },
] as const;

for (const leaf of LEAVES) {
  test(`${leaf.path} paints a heading instead of a blank board`, async ({ page }) => {
    await page.goto(leaf.path);
    await expect(page.locator("body")).not.toContainText("Application error");
    const heading = page.getByRole("heading", { level: 1 }).filter({ hasText: leaf.heading });
    const setup = page.getByRole("heading", { name: "Choose your team", exact: true });
    const unavailable = loadFailureHeading(page);
    if (!(await expectHubReadyOrGate(page, heading, setup.or(unavailable)))) {
      await page.screenshot({
        path: `/opt/cursor/artifacts/${leaf.path.slice(1)}-last-snapshot.png`,
        fullPage: true,
      });
      return;
    }
    await expect(heading.first()).toBeVisible();
    await expect(page.getByText("VANTAGE /")).toHaveCount(0);
  });
}
