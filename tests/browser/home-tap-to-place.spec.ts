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
    await expect(page.getByText(/Tap a slot on the board to place/i).first()).toBeVisible();
    const canvas = page.getByTestId("dash-place-canvas");
    await expect(canvas).toBeVisible();

    // Tap where a student can actually see a slot. `canvas.click()` asks the
    // browser to scroll the point into view first, which parks the board's top
    // row under the fixed top bar and then clicks the bar instead.
    const board = await canvas.boundingBox();
    const bar = await page.locator(".soft-topbar").boundingBox();
    expect(board).not.toBeNull();
    const slotX = board!.x + 24;
    const slotY = Math.max(board!.y + 24, (bar?.height ?? 0) + 24);
    await page.mouse.click(slotX, slotY);

    await expect(page.getByText(/added to the board/i).first()).toBeVisible();
  });
});
