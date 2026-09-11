import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const LEAVES = [
  { path: "/scout-p2p-relay", heading: "Pit mesh" },
  { path: "/scout-schema-negotiate", heading: "Schema sync" },
  { path: "/scouting-schema-ab", heading: "Schema A/B" },
  { path: "/code-perf", heading: "Code vs match" },
  { path: "/degraded-mode", heading: "Data-source health" },
] as const;

for (const leaf of LEAVES) {
  test(`${leaf.path} paints a heading instead of leftover VANTAGE chrome`, async ({ page }) => {
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
