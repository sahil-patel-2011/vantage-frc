import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

/*
  Adding a widget on a phone works the way it does on a laptop: tap it in the
  sheet and it is on the board. Phones used to switch to "tap a slot on the
  board to place it", with no slots shown and nothing happening when testers
  tapped the empty space under the last card.
*/
test.describe("Home add widget on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test.beforeEach(async ({ context }) => {
    await signInFixture(context);
    // A real phone reports a coarse pointer; desktop Chrome at 390px does not.
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

  test("tapping a widget in the sheet puts it on the board and shows it", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");
    const edit = page.getByRole("button", { name: /edit home/i });
    await expect(edit.first()).toBeVisible({ timeout: 20_000 });
    await edit.first().click();
    // On a phone the app's tab bar steps aside for the edit toolbar.
    await expect(page.locator(".soft-island")).toBeHidden({ timeout: 10_000 });
    const cards = page.getByTestId("dash-grid-item");
    const before = await cards.count();

    await page.getByTestId("dash-open-library").click();
    const sheet = page.getByTestId("dash-widget-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Tap one to add it to your board.")).toBeVisible();
    const firstAdd = page.locator("[data-testid^='dash-library-']").first();
    const type = (await firstAdd.getAttribute("data-testid"))!.replace("dash-library-", "");
    await firstAdd.tap();

    // No second "tap a slot" step: the sheet closes and the card is there.
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText(/Tap a slot on the board/i)).toHaveCount(0);
    await expect(page.getByTestId("dash-toast")).toContainText("added to the board");
    await expect(cards).toHaveCount(before + 1);
    const added = page.locator(`[data-testid='dash-grid-item'][data-widget-type='${type}']`);
    await expect(added).toBeInViewport();
    await expect(added).toHaveClass(/is-new/);
  });
});
