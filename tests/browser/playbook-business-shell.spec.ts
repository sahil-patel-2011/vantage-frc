import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const LEAVES = [
  { path: "/sponsor-tier-calculator", heading: /Tier calculator|Sponsors/i },
  { path: "/knowledge-drafts", heading: /Knowledge drafts/i },
  { path: "/team/grants/calendar", heading: /Grant calendar/i },
  { path: "/team/background", heading: /Team background/i },
  { path: "/team/getting-started", heading: /Getting started|Team setup/i },
] as const;

for (const leaf of LEAVES) {
  test(`${leaf.path} paints a heading instead of leftover VANTAGE chrome`, async ({ page }) => {
    await page.goto(leaf.path);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: leaf.heading })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("VANTAGE /")).toHaveCount(0);
  });
}
