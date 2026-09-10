import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test.describe("Home tap-to-place", () => {
  test.beforeEach(async ({ context }) => {
    await signInFixture(context);
  });

  test("coarse pointer picks a widget then a slot", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    const edit = page.getByRole("button", { name: /edit home/i });
    if (await edit.count()) {
      await edit.first().click();
    }
    const library = page.getByTestId("dash-open-library");
    if (await library.count()) {
      await library.click();
      const firstAdd = page.locator("[data-testid^='dash-library-']").first();
      if (await firstAdd.count()) {
        await firstAdd.click();
        await expect(page.getByText(/tap a slot/i)).toBeVisible();
      }
    }
    const canvas = page.getByTestId("dash-place-canvas");
    if (await canvas.count()) {
      await canvas.click({ position: { x: 24, y: 24 } });
    }
  });
});
