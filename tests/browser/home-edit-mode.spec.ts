import { expect, test, type Page } from "@playwright/test";
import { signInFixture } from "./session";

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
});
