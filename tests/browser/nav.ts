import type { Page } from "@playwright/test";

/** Desktop navigation is available inside the drawer; mobile keeps its shortcuts. */
export function primaryNavigation(page: Page) {
  return page.getByRole("navigation", { name: page.viewportSize()!.width >= 1024 ? "Main menu" : "Primary apps", exact: true });
}

/** Open the same on-demand navigation drawer at every screen size. */
export async function openNav(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menu and search", exact: true }).click();
}

/** Destination groups belong to the one hamburger menu. */
export async function openMenuSection(page: Page, label: string) {
  await openNav(page);
  const section = page.locator(".main-menu-section").filter({ has: page.locator("summary").filter({ hasText: new RegExp(`^${label}$`) }) });
  await section.locator("summary").click();
  return section.getByRole("navigation", { name: label, exact: true });
}
