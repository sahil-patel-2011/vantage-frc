import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Posture / Export audit boards drop VANTAGE / mill prefix", async ({ page }) => {
  test.setTimeout(90_000);
  const routes = [
    { path: "/team/posture", heading: /access at a glance|Posture|Choose your team/ },
    { path: "/team/security/exports", heading: /took a copy|Export audit|Choose your team/ },
  ] as const;
  for (const route of routes) {
    await page.goto(route.path);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible();
    await expect(page.locator("body"), `${route.path} still shows VANTAGE /`).not.toContainText(
      "VANTAGE /",
    );
  }
});
