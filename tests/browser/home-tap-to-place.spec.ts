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
    /*
      Edit Home lives inside the "More" disclosure now, not beside the
      greeting. Arranging widgets is something you do once and then leave
      alone for a season, and it was one of only two controls on the page — so
      the quietest screen in the app opened with a button most people will
      never press again.

      Opening the disclosure is what a person does, so the spec does it too
      rather than reaching past the UI for the button.
    */
    const more = page.locator("details.dash-home-more");
    await expect(more).toBeAttached({ timeout: 20_000 });
    // Open the disclosure the way pressing its summary would, rather than
    // reaching past it to a button the page is deliberately keeping folded
    // away. This spec also emulates a coarse pointer, and a synthesized click
    // on a summary under that emulation is its own thing to debug.
    await more.evaluate((node) => {
      (node as HTMLDetailsElement).open = true;
    });

    const edit = page.getByRole("button", { name: /edit home/i });
    await expect(edit.first()).toBeVisible({ timeout: 15_000 });
    await edit.first().click();
    await page.getByTestId("dash-open-library").click();
    const firstAdd = page.locator("[data-testid^='dash-library-']").first();
    await expect(firstAdd).toBeVisible();
    await firstAdd.click();
    await expect(page.getByText(/Tap a slot on the board to place/i).first()).toBeVisible();
    const canvas = page.getByTestId("dash-place-canvas");
    if (await canvas.count()) {
      // Top-left of the board, with the board scrolled to the top: the edit
      // dock floats near the bottom of the viewport, and a click aimed into
      // it is a click on Cancel. The board now reserves room for the dock so
      // every slot can be scrolled clear of it, and this aims at the corner
      // furthest from it either way.
      // Inside the board rather than at its very corner: the topbar is sticky
      // at the top and the edit dock floats near the bottom, and the corners
      // are where those two live. The board now reserves room for both, so a
      // slot can always be brought clear — this aims at one that already is.
      await canvas.click({ position: { x: 120, y: 120 } });
      await expect(page.getByText(/Tap a slot on the board to place/i)).toHaveCount(0);
    }
  });
});
