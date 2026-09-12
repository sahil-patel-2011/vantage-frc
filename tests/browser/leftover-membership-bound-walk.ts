import { expect, type Page } from "@playwright/test";

export async function assertNoMembershipBound(
  page: Page,
  routes: readonly { path: string; extra?: readonly string[] }[],
): Promise<void> {
  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByText("membership-bound")).toHaveCount(0);
    for (const phrase of route.extra ?? []) {
      await expect(page.getByText(phrase)).toHaveCount(0);
    }
  }
}
