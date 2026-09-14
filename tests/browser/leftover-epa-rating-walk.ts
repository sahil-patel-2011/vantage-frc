import { expect, type Page } from "@playwright/test";
import { waitForLoadingGone } from "./ready";

export async function assertNoLeftoverEpaRating(
  page: Page,
  path: string,
  heading: RegExp,
): Promise<void> {
  await page.goto(path);
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  await expect(page.locator("body"), `${path} still shows EPA Trend Alerts`).not.toContainText(
    "EPA Trend Alerts",
  );
  await expect(page.locator("body"), `${path} still shows EPA alerts`).not.toContainText("EPA alerts");
  await expect(page.locator("body"), `${path} still shows EPA swings`).not.toContainText("EPA swings");
  await expect(page.locator("body"), `${path} still shows TBA/Statbotics`).not.toContainText(
    "TBA/Statbotics",
  );
  await expect(page.locator("body"), `${path} still shows Season EPA`).not.toContainText("Season EPA");
}
