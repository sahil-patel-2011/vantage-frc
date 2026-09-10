import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test.describe("Home tap-to-place", () => {
  // Library placement keys off matchMedia("(pointer: coarse)"), not the click's
  // pointerType. Desktop Chrome at a 390px viewport still reports a fine pointer,
  // so the widget is added immediately ("…added to the board") unless we emulate
  // a phone and stub coarse.
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test.beforeEach(async ({ context }) => {
    await signInFixture(context);
    await context.addInitScript(() => {
      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        if (String(query).includes("pointer: coarse")) {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return false;
            },
          };
        }
        return originalMatchMedia(query);
      };
    });
  });

  test("coarse pointer picks a widget then a slot", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    const edit = page.getByRole("button", { name: /edit home/i });
    await expect(edit.first()).toBeVisible();
    await edit.first().click();
    await page.getByTestId("dash-open-library").click();
    const firstAdd = page.locator("[data-testid^='dash-library-']").first();
    await expect(firstAdd).toBeVisible();
    await firstAdd.click();
    await expect(page.getByText(/tap a slot/i)).toBeVisible();
    const canvas = page.getByTestId("dash-place-canvas");
    if (await canvas.count()) {
      await canvas.click({ position: { x: 24, y: 24 } });
    }
  });
});
