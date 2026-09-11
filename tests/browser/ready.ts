import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Student shells paint an EmptyState <h2>Loading…</h2> (or "Loading Video…")
 * after the page <h1> is already visible. Asserting product copy in that
 * window is a false failure: banned phrases are absent because the ready
 * card has not painted yet. Wait until those headings leave.
 */
export async function waitForLoadingGone(page: Page, timeout = 20_000): Promise<void> {
  await expect(page.locator("body")).not.toContainText("Application error");
  const loading = page.getByRole("heading", { name: /^Loading/ });
  await loading
    .first()
    .waitFor({ state: "hidden", timeout })
    .catch(() => undefined);
  await page
    .locator("[aria-busy='true']")
    .first()
    .waitFor({ state: "hidden", timeout: Math.min(timeout, 8_000) })
    .catch(() => undefined);
}

/** After goto, wait out Loading… then require at least one of the locators. */
export async function expectReadyOr(
  page: Page,
  first: Locator,
  second: Locator,
  timeout = 20_000,
): Promise<boolean> {
  await waitForLoadingGone(page, timeout);
  await expect(first.or(second)).toBeVisible({ timeout });
  return (await first.count()) > 0 && (await first.isVisible());
}
