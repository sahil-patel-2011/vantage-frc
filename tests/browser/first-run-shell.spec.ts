import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const LEAVES = [
  { path: "/start", heading: /Your path/i },
  { path: "/security", heading: /Security/i },
  { path: "/notifications/preferences", heading: /Notification preferences/i },
  { path: "/cad/connections", heading: /CAD connections|Choose your team/i },
] as const;

for (const leaf of LEAVES) {
  test(`${leaf.path} paints a heading instead of leftover VANTAGE chrome`, async ({ page }) => {
    await page.goto(leaf.path);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: leaf.heading })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("VANTAGE /")).toHaveCount(0);
    await expect(page.getByText("ONSHAPE_OAUTH_CLIENT_ID")).toHaveCount(0);
  });
}
