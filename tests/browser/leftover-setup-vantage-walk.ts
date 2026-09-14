import { expect, type Page } from "@playwright/test";
import { waitForLoadingGone } from "./ready";

export const LEFTOVER_SETUP_VANTAGE_BANNED = [
  "Setup required",
  "VANTAGE / FORMS",
  "TBA/Statbotics",
  "Sync reference data",
] as const;

export async function assertLeftoverSetupVantageChromeGone(
  page: Page,
  routes: readonly string[],
): Promise<void> {
  for (const route of routes) {
    await page.goto(route);
    await waitForLoadingGone(page);
    for (const phrase of LEFTOVER_SETUP_VANTAGE_BANNED) {
      await expect(page.locator("body"), `${route} still shows ${phrase}`).not.toContainText(phrase);
    }
  }
}
