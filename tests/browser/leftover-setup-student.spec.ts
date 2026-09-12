import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover student boards no longer print Setup required", async ({ page }) => {
  test.setTimeout(120_000);
  const routes = ["/fmea", "/team/relays", "/alumni-network", "/start", "/subsystems", "/roadmap", "/code"];
  for (const route of routes) {
    await page.goto(route);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body"), `${route} still shows Setup required`).not.toContainText(
      "Setup required",
    );
  }
});
