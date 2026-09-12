import { expect, type Page } from "@playwright/test";
import { waitForLoadingGone } from "./ready";

export async function assertStudentBoardsHaveNoSetupRequired(
  page: Page,
  routes: readonly string[],
): Promise<void> {
  for (const route of routes) {
    await page.goto(route);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body"), `${route} still shows Setup required`).not.toContainText(
      "Setup required",
    );
  }
}
