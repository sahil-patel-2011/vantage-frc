import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Display / Audit boards drop VANTAGE / mill prefix", async ({ page }) => {
  test.setTimeout(90_000);
  const routes = [
    { path: "/display", heading: /Display|Choose your team/ },
    { path: "/team/audit", heading: /Audit|Who changed what|Choose your team/ },
  ] as const;
  for (const route of routes) {
    await page.goto(route.path);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible();
    await expect(page.locator("body"), `${route.path} still shows VANTAGE /`).not.toContainText(
      "VANTAGE /",
    );
    await expect(page.locator("body"), `${route.path} still says pick the team first`).not.toContainText(
      "pick the team first",
    );
  }
});
