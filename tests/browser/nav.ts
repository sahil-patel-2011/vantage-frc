import type { Page } from "@playwright/test";

/** The desktop rail replaces the phone app bar; exercise the visible primary destinations. */
export function primaryNavigation(page: Page) {
  return page.getByRole("navigation", { name: page.viewportSize()!.width >= 1024 ? "Pillars" : "Primary apps", exact: true });
}

/**
 * Open the product navigation panel the way a person would at this screen size: the top bar's
 * menu button on phones and tablets, the sidebar's Search on desktop (where the sidebar lists the
 * workspaces and the menu button is hidden because it would only open a second copy).
 */
export async function openNav(page: Page): Promise<void> {
  const menu = page.getByRole("button", { name: "Menu and search" });
  if (await menu.isVisible()) {
    await menu.click();
    return;
  }
  await page.locator(".vrail-search").click();
}
