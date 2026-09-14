import { expect, type Page } from "@playwright/test";
import { waitForLoadingGone } from "./ready";

export const LEFTOVER_SCHEMA_BANNED = [
  "Setup required",
  "org- and season-scoped",
  "published schemas",
  "versioned match or pit schemas",
  "TBA/Statbotics",
  "AI provider not configured",
  "Hard usage cutoffs",
  "Connect Onshape with OAuth",
] as const;

export async function assertLeftoverSchemaChromeGone(
  page: Page,
  routes: readonly string[],
): Promise<void> {
  for (const route of routes) {
    await page.goto(route);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    for (const phrase of LEFTOVER_SCHEMA_BANNED) {
      await expect(page.locator("body"), `${route} still shows ${phrase}`).not.toContainText(phrase);
    }
  }
}
