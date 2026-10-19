import type { Page } from "@playwright/test";

/**
 * The five places (Home, Competition, Team, Build, Business): the sidebar on a desktop-width
 * page, the bottom bar on phones and tablets. Both are the navigation "Places"; only one of the
 * two is visible at a time. There is no menu drawer.
 */
export function primaryNavigation(page: Page) {
  return page.locator('nav[aria-label="Places"]:visible');
}

/**
 * Where a person starts a search: the top bar's "Search or ask" (the field on desktop, the
 * magnifier on phones). It opens the search palette; ⌘K / Ctrl+K does too, at every width.
 */
export function searchOpener(page: Page) {
  return page.locator(".app-topbar-search:visible");
}

/** The search palette: ⌘K / Ctrl+K, and "Search or ask" in the top bar. */
export function searchPalette(page: Page) {
  return page.getByRole("dialog", { name: "Search Vantage", exact: true });
}

/** Start a search the way a person would. */
export async function openSearch(page: Page): Promise<void> {
  await searchOpener(page).click();
}

/** Go to one of the five places the way a person would at this width. */
export async function openPlace(page: Page, label: "Home" | "Competition" | "Team" | "Build" | "Business"): Promise<void> {
  await primaryNavigation(page).getByRole("link", { name: label, exact: false }).first().click();
}

/** Open the account menu (Your profile, Settings, Help, Admin, Sign out). */
export async function openAccountMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
}

/**
 * A place's sections: the hub's own tab bar, reached through the place. Returns the hub's tab
 * list so a spec can check or click a section.
 */
export async function openPlaceSections(page: Page, label: "Competition" | "Team" | "Build" | "Business") {
  await openPlace(page, label);
  return page.getByRole("tablist").first();
}
