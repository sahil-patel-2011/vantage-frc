import type { Page } from "@playwright/test";

/**
 * Phones and tablets: the hamburger, which opens the menu. A desktop-width page has the sidebar
 * instead, so there is no menu button there.
 */
export function navigationOpener(page: Page) {
  return page.locator(".soft-menu-btn:visible");
}

/**
 * Where a person starts a search at this width: the top bar's "Search anything" on desktop (it
 * opens the search palette), the menu on phones and tablets (its search field). Both fields are
 * the combobox "Search pages, tools, and your team's data". ⌘K / Ctrl+K opens the palette at
 * every width.
 */
export function searchOpener(page: Page) {
  return page.locator(".app-topbar-search:visible, .soft-menu-btn:visible");
}

/** The search palette: ⌘K / Ctrl+K, and "Search anything" on desktop. */
export function searchPalette(page: Page) {
  return page.getByRole("dialog", { name: "Search Vantage", exact: true });
}

/** Desktop has a persistent workspace sidebar; smaller screens keep shortcuts. */
export function primaryNavigation(page: Page) {
  return page.getByRole("navigation", { name: page.viewportSize()!.width >= 1100 ? "Workspaces" : "Primary apps", exact: true });
}

/** Open the menu (phones and tablets). */
export async function openNav(page: Page): Promise<void> {
  await navigationOpener(page).click();
}

/** Start a search the way a person would at this width (palette on desktop, menu on phones). */
export async function openSearch(page: Page): Promise<void> {
  await searchOpener(page).click();
}

/** Destination groups belong to the one hamburger menu. */
export async function openMenuSection(page: Page, label: string) {
  await openNav(page);
  const section = page.locator(".main-menu-section").filter({ has: page.locator("summary").filter({ has: page.getByText(label, { exact: true }) }) });
  if (await section.getAttribute("open") === null) await section.locator("summary").click();
  return section.getByRole("navigation", { name: label, exact: true });
}
