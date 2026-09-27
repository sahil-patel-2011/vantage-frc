import { expect, type Page } from "@playwright/test";
import { MEDIA_ENABLED } from "../../apps/web/lib/media-availability";

/**
 * Upload, capture and storage surfaces are disabled by MEDIA_ENABLED.
 * External video links, timestamps, notes and supported analysis are separate
 * features and must continue to work without uploads; do not gate their tests
 * through this helper.
 */
export const mediaPaused = !MEDIA_ENABLED;

/**
 * The paused page, not the API's JSON.
 *
 * This is the regression the pause shipped with: page requests were answered
 * with `{"error":…,"code":"media_paused"}`, so a student tapping Match video in
 * the menu saw a raw error object. It must now be a page that names the tool
 * and offers a way on.
 */
export async function expectPausedPage(page: Page, tool: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: `${tool} is paused` })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("body")).not.toContainText("media_paused");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
}
