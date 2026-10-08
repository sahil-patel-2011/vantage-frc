import type { Page } from "@playwright/test";

/** The visible opener survives switching between desktop search and mobile menu. */
export function navigationOpener(page: Page) {
  return page.locator(".app-topbar-search:visible, .soft-menu-btn:visible");
}

/** Desktop has a persistent workspace sidebar; smaller screens keep shortcuts. */
export function primaryNavigation(page: Page) {
  return page.getByRole("navigation", { name: page.viewportSize()!.width >= 1100 ? "Workspaces" : "Primary apps", exact: true });
}

/** Open the same on-demand navigation drawer at every screen size. */
export async function openNav(page: Page): Promise<void> {
  await navigationOpener(page).click();
}

/** Destination groups belong to the one hamburger menu. */
export async function openMenuSection(page: Page, label: string) {
  await openNav(page);
  const section = page.locator(".main-menu-section").filter({ has: page.locator("summary").filter({ has: page.getByText(label, { exact: true }) }) });
  if (await section.getAttribute("open") === null) await section.locator("summary").click();
  return section.getByRole("navigation", { name: label, exact: true });
}
