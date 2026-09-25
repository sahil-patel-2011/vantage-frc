import { expect, test, type Page } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

/*
  Edit mode on Home, the way usability testers used it: the board stays where
  it was, removing a card can be undone, Reset and Escape ask before throwing
  work away, and on a phone the edit toolbar is the only bar at the bottom.
*/

test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

async function enterEdit(page: Page) {
  await page.goto("/dashboard");
  const edit = page.getByTestId("dash-customize");
  await expect(edit).toBeVisible({ timeout: 20_000 });
  await edit.click();
  await expect(page.getByTestId("dash-edit-toolbar")).toBeVisible();
  await expect(page.getByTestId("dash-grid-item").first()).toBeVisible();
}

test("removing a card offers Undo, and Ctrl+Z steps back too", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterEdit(page);
  const cards = page.getByTestId("dash-grid-item");
  const count = await cards.count();
  expect(count).toBeGreaterThan(1);

  const remove = page.getByTestId("dash-remove-widget").nth(1);
  const label = (await remove.getAttribute("aria-label"))!.replace(/^Remove /, "");
  await remove.click();
  await expect(cards).toHaveCount(count - 1);
  // The status appears by the toolbar, not at the top of the page.
  const toast = page.getByTestId("dash-toast");
  await expect(toast).toContainText(`${label} removed.`);
  await page.getByTestId("dash-toast-undo").click();
  await expect(cards).toHaveCount(count);

  await page.getByTestId("dash-remove-widget").first().click();
  await expect(cards).toHaveCount(count - 1);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Control+z");
  await expect(cards).toHaveCount(count);
});

test("Escape asks before discarding changes, and Reset only changes the draft", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterEdit(page);
  const cards = page.getByTestId("dash-grid-item");
  const count = await cards.count();

  // Nothing changed: Escape just leaves.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dash-edit-toolbar")).toHaveCount(0);

  await page.getByTestId("dash-customize").click();
  await page.getByTestId("dash-remove-widget").first().click();
  await expect(cards).toHaveCount(count - 1);
  await page.keyboard.press("Escape");
  const dialog = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByTestId("dash-edit-toolbar")).toBeVisible();
  await expect(cards).toHaveCount(count - 1);

  // Reset asks first, then stays in edit mode with nothing saved.
  await page.getByTestId("dash-edit-more").click();
  await page.getByTestId("dash-reset-board").click();
  const confirm = page.getByRole("dialog", { name: "Reset this board?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Reset board" }).click();
  await expect(page.getByTestId("dash-toast")).toContainText("Tap Done to keep it");
  await expect(page.getByTestId("dash-edit-toolbar")).toBeVisible();

  await page.getByTestId("dash-remove-widget").first().click();
  await page.getByTestId("dash-edit-cancel").click();
  await page.getByRole("dialog", { name: "Discard changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByTestId("dash-edit-toolbar")).toHaveCount(0);
});

test("the widget sheet searches, and cards hidden on Home are labelled", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterEdit(page);
  await page.getByTestId("dash-open-library").click();
  const sheet = page.getByTestId("dash-widget-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Match day" })).toBeVisible();
  await page.getByTestId("dash-widget-search").fill("battery");
  await expect(sheet.getByText("Batteries", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Match day" })).toHaveCount(0);
  await page.getByTestId("dash-widget-search").fill("zzzz no such widget");
  await expect(sheet.getByText(/No widgets match/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // Escape closed the sheet, not edit mode.
  await expect(page.getByTestId("dash-edit-toolbar")).toBeVisible();
});

/*
  These turn on the team's real board (what Home hides, the team's boards),
  so they need a real owner session, not just the proxy fixture.
*/
test.describe("as the team owner", () => {
  test.beforeEach(async ({ context }) => {
    test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
  });

  test("cards Home is hiding sit in one row under the board, and can be always shown", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterEdit(page);
    const row = page.getByTestId("dash-hidden-row");
    // The seeded team is set up, so at least its setup card is hidden on Home.
    await expect(row).toBeVisible();
    const hiddenTypes = await row
      .getByTestId("dash-hidden-item")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.widgetType));
    expect(hiddenTypes.length).toBeGreaterThan(0);
    await expect(row.locator("summary")).toContainText(`Hidden right now (${hiddenTypes.length})`);
    // None of them is also painted as a card on the board.
    for (const type of hiddenTypes) {
      await expect(page.locator(`[data-testid='dash-grid-item'][data-widget-type='${type}']`)).toHaveCount(0);
    }

    const cards = page.getByTestId("dash-grid-item");
    const count = await cards.count();
    await row.locator("summary").click();
    await row.getByTestId("dash-always-show").first().click();
    await expect(cards).toHaveCount(count + 1);
    await expect(page.locator(`[data-testid='dash-grid-item'][data-widget-type='${hiddenTypes[0]}']`)).toHaveCount(1);
    await expect(page.getByTestId("dash-toast")).toContainText("will always show on Home");
    await page.getByTestId("dash-toast-undo").click();
    await expect(cards).toHaveCount(count);
  });

  test("Snap & tidy only says cards moved when they did", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterEdit(page);
    // The first tidy may have gaps to close (cards can hide or come back
    // while the board's data arrives); straight after it there are none, and
    // the toast must not claim otherwise.
    const toast = page.getByTestId("dash-toast");
    await page.getByTestId("dash-edit-more").click();
    await page.getByTestId("dash-tidy").click();
    await expect(toast).toHaveText(/Nothing to tidy\.|Board tidied\./);
    await page.getByTestId("dash-edit-more").click();
    await page.getByTestId("dash-tidy").click();
    await expect(toast).toHaveText(/Nothing to tidy\./);
  });

  test("Save for team asks first and keeps you on your own board", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterEdit(page);
    const chip = page.getByTestId("dash-board-chip");
    await page.getByTestId("dash-edit-more").click();
    await page.getByTestId("dash-save-team").click();
    const dialog = page.getByRole("dialog", { name: /team board|for the team/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    // Nothing was saved or switched: still editing, still on a board of your own.
    await expect(page.getByTestId("dash-edit-toolbar")).toBeVisible();
    await expect(chip).toHaveAttribute("data-scope", "personal");
    await expect(page.getByTestId("dash-toast")).toHaveCount(0);
  });

  test("the board chip beside the greeting switches and manages boards", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const chip = page.getByTestId("dash-board-chip");
    await expect(chip).toBeVisible({ timeout: 20_000 });
    // The old tab strip is gone, with one board or several.
    await expect(page.locator(".dash-board-bar")).toHaveCount(0);
    await chip.click();
    const menu = page.getByTestId("dash-board-menu");
    await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveCount(1);
    await expect(menu.getByRole("menuitem", { name: "New board…" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Manage boards" }).click();
    await expect(page.getByRole("dialog", { name: "Your boards" })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the edit toolbar replaces the tab bar and fits on one line", async ({ page }) => {
    await enterEdit(page);
    await expect(page.locator(".soft-island")).toBeHidden();
    const tops = await page
      .getByTestId("dash-edit-toolbar")
      .locator("button")
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // The first card is on screen, not below the fold.
    const top = await page.getByTestId("dash-grid-item").first().evaluate((node) => node.getBoundingClientRect().top);
    expect(top).toBeLessThan(844 - 200);
  });

  test("the remove and move controls are finger-sized", async ({ page }) => {
    await enterEdit(page);
    for (const id of ["dash-remove-widget", "dash-drag-handle"]) {
      const box = await page.getByTestId(id).first().boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      // All of it on screen.
      expect(box!.x).toBeGreaterThanOrEqual(0);
    }
  });
});
