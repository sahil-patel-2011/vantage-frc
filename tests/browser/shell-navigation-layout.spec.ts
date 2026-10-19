import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAs } from "./session";
import { openSearch, primaryNavigation, searchOpener, searchPalette } from "./nav";

// Network interception must reach the page rather than a service worker's warm-up cache.
test.use({ serviceWorkers: "block" });

test("a hub shows its loading surface while the tool bundle downloads", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  let release!: () => void;
  let blocked = false;
  const download = new Promise<void>(resolve => { release = resolve; });
  const chunks = /\/_next\/static\/chunks\/.*\.js/;
  await page.route(chunks, async route => {
    const response = await route.fetch();
    // Identify product content; function names change when production bundles are minified.
    if ((await response.text()).includes("kick-embedded-controls")) {
      blocked = true;
      await download;
    }
    await route.fulfill({ response });
  });
  try {
    await page.goto("/build", { waitUntil: "domcontentloaded" });
    await expect.poll(() => blocked).toBe(true);
    await expect(page.getByRole("status", { name: "Loading section", exact: true })).toBeVisible();
    release();
    await expect(page.locator(".kick-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "How the game works", exact: true })).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading section", exact: true })).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("pins are shortcuts on top of the five places, never a second set of them", async ({ page, context }, info) => {
  expect(await signInAs(context, "owner")).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.route("**/api/navigation/preferences", route => route.fulfill({ json: {
    tabs: ["/dashboard", "/competition", "/rankings", "/ai?tab=chat"],
  } }));
  // Phone: the bottom bar is the five places whatever is pinned; pins lead empty search.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/dashboard");
  await expect(primaryNavigation(page).getByRole("link")).toHaveText(["Home", "Compete", "Team", "Build", "Business"]);
  await openSearch(page);
  // A pin to a place itself (Home) is not repeated: the bar already has it.
  await expect(searchPalette(page).getByRole("navigation", { name: "Pinned", exact: true }).getByRole("link")).toHaveText(["Event day", "Stats", "Ask AI"]);
  await page.keyboard.press("Escape");
  // Desktop: the same pins in the sidebar, under the five places.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("navigation", { name: "Pinned", exact: true }).getByRole("link")).toHaveText(["Event day", "Stats", "Ask AI"]);
  await expect(primaryNavigation(page).getByRole("link")).toHaveText(["Home", "Competition", "Team", "Build", "Business"]);
  await page.screenshot({ path: info.outputPath("pins-sidebar.png") });
});

test("desktop workspace navigation reserves its own space before hydration", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  try {
    expect(await signInAs(context, "owner")).toBe(true);
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page.locator(".vrail")).toHaveCount(0);
    await expect(page.locator(".soft-island")).toBeHidden();
    await expect(page.locator(".app-sidebar")).toBeVisible();
    await expect(page.locator(".soft-drawer")).toBeHidden();
    expect(await page.locator("body").evaluate(body => parseFloat(getComputedStyle(body).paddingLeft))).toBe(244);
    const header = await page.locator(".soft-topbar").boundingBox();
    expect(header?.x).toBe(244);
  } finally {
    await context.close();
  }
});

test("the five places and search survive routes and desktop breakpoint changes", async ({ page, context }, info) => {
  test.setTimeout(180_000);
  expect(await signInAs(context, "owner")).toBe(true);
  for (const width of [390, 768, 1023, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".soft-topbar")).toHaveCount(1);
    await expect(page.locator(".vrail")).toHaveCount(0);
    // No menu drawer and no hamburger, at any width.
    await expect(page.locator(".soft-drawer:visible, .soft-menu-btn:visible")).toHaveCount(0);
    await expect(page.locator(".app-sidebar")).toBeVisible({ visible: width >= 1100 });
    await expect(page.locator(".soft-island")).toBeVisible({ visible: width < 1100 });
    expect(await page.locator("body").evaluate(body => parseFloat(getComputedStyle(body).paddingLeft))).toBe(width >= 1100 ? 244 : 0);
    await page.screenshot({ path: info.outputPath(`navigation-${width}.png`) });
    const audit = await new AxeBuilder({ page }).include(width >= 1100 ? ".app-sidebar" : ".soft-island").include(".soft-topbar").analyze();
    expect(audit.violations).toEqual([]);
    await openSearch(page);
    await expect(searchPalette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(searchPalette(page)).toBeHidden();
    await expect(searchOpener(page)).toBeFocused();
    await primaryNavigation(page).getByRole("link", { name: "Competition", exact: true }).click();
    await expect(page).toHaveURL(/\/competition/);
    await expect(primaryNavigation(page).getByRole("link", { name: "Competition", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Competition sections", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  // Opened on one side of the breakpoint and closed on the other, focus lands on the search
  // control that is there now.
  for (const [from, to] of [[390, 1440], [1440, 390]]) {
    await page.setViewportSize({ width: from, height: 900 });
    await openSearch(page);
    await page.setViewportSize({ width: to, height: 900 });
    await page.keyboard.press("Escape");
    await expect(searchOpener(page)).toBeVisible();
    await expect(searchOpener(page)).toBeFocused();
  }
});
