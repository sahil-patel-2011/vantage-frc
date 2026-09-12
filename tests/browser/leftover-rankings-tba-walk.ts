import { expect, type Page } from "@playwright/test";
import { waitForLoadingGone } from "./ready";

export async function assertNoLeftoverRankingsTba(
  page: Page,
  path: string,
  heading: RegExp,
): Promise<void> {
  await page.goto(path);
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  await expect(page.locator("body"), `${path} still shows TBA/Statbotics`).not.toContainText(
    "TBA/Statbotics",
  );
  await expect(page.locator("body"), `${path} still shows Current TBA`).not.toContainText("Current TBA");
  await expect(page.locator("body"), `${path} still shows Season EPA`).not.toContainText("Season EPA");
  await expect(page.locator("body"), `${path} still shows opponent EPA`).not.toContainText("opponent EPA");
}
