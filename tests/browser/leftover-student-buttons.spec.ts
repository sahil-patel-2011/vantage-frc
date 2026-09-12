import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Code / Discord / Support boards use gold chrome", async ({ page }) => {
  test.setTimeout(90_000);
  const routes = [
    { path: "/code", heading: /FRC Code Coach|Choose your team/ },
    { path: "/team/discord", heading: /Discord|Choose your team/ },
    { path: "/support", heading: /Support|Choose your team/ },
  ] as const;
  for (const route of routes) {
    await page.goto(route.path);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible();
    await expect(page.locator("body"), `${route.path} still shows Setup required`).not.toContainText(
      "Setup required",
    );
  }
});
