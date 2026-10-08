import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAs } from "./session";
import { openNav } from "./nav";

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

test("desktop destinations have one menu without repeating saved shortcuts", async ({ page, context }, info) => {
  expect(await signInAs(context, "owner")).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.route("**/api/navigation/preferences", route => route.fulfill({ json: {
    tabs: ["/dashboard", "/competition", "/rankings", "/ai?tab=chat"],
  } }));
  await page.goto("/dashboard");
  const panel = page.getByRole("dialog", { name: "Product navigation", exact: true });
  await expect(panel).toBeHidden();
  await openNav(page);
  await expect(panel.locator(".soft-drawer-shortcuts")).toHaveCount(0);
  await expect(panel.locator(".main-menu-launch a")).toHaveCount(2);
  await panel.locator(".main-menu-section > summary").filter({ has: page.getByText("AI", { exact: true }) }).click();
  await panel.getByRole("navigation", { name: "AI", exact: true }).getByRole("link", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/ai/);
  await expect(panel).toBeHidden();
  await expect(page.getByRole("combobox", { name: "AI section", exact: true })).toHaveCount(0);
  await expect(page.locator(".workspace-hub-header h1")).toHaveText("Chat");
  await expect(page.getByRole("heading", { name: /^Loading assistant/ })).toBeHidden({ timeout: 30_000 });
  await page.screenshot({ path: info.outputPath("ai-sidebar-collapsed.png") });
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

test("workspace navigation and search survive routes and desktop breakpoint changes", async ({ page, context }, info) => {
  test.setTimeout(180_000);
  expect(await signInAs(context, "owner")).toBe(true);
  for (const width of [390, 768, 1023, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const hamburger = page.getByRole("button", { name: "Menu and search", exact: true });
    await expect(page.locator(".soft-topbar")).toHaveCount(1);
    await expect(page.locator(".vrail")).toHaveCount(0);
    await expect(page.locator(".soft-drawer")).toHaveCount(1);
    await expect(hamburger).toBeVisible({ visible: width < 1100 });
    await expect(page.locator(".app-sidebar")).toBeVisible({ visible: width >= 1100 });
    await expect(page.locator(".soft-drawer")).toBeHidden();
    expect(await page.locator("body").evaluate(body => parseFloat(getComputedStyle(body).paddingLeft))).toBe(width >= 1100 ? 244 : 0);
    await page.screenshot({ path: info.outputPath(`navigation-closed-${width}.png`) });
    await openNav(page);
    const panel = page.getByRole("dialog", { name: "Product navigation", exact: true });
    await expect(panel).toBeVisible();
    await expect(hamburger).toBeHidden();
    await expect(page.locator(".vrail")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Primary apps", exact: true })).toBeHidden();
    await expect.poll(() => panel.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
    await expect.poll(() => panel.evaluate(el => Math.abs(el.getBoundingClientRect().left - 10))).toBeLessThan(2);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState !== "running"));
    const audit = await new AxeBuilder({ page }).analyze();
    await info.attach(`navigation-${width}.json`, { body: JSON.stringify(audit), contentType: "application/json" });
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`navigation-${width}.png`) });
    await panel.getByRole("link", { name: /^Scouting/ }).click();
    await expect(page).toHaveURL(/\/competition/);
    await expect(panel).toBeHidden();
    await expect(page.locator(".soft-topbar")).toHaveCount(1);
    await expect(page.getByRole("combobox", { name: "Competition section", exact: true })).toHaveCount(0);
    await expect(page.locator(".workspace-hub-header h1")).toHaveText("Scout");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  for (const [from, to] of [[390, 1440], [1440, 390]]) {
    await page.setViewportSize({ width: from, height: 900 });
    await openNav(page);
    await page.setViewportSize({ width: to, height: 900 });
    await page.keyboard.press("Escape");
    const opener = page.getByRole("button", { name: to >= 1100 ? "Search pages, tools, and team data" : "Menu and search", exact: true });
    await expect(opener).toBeVisible();
    await expect(opener).toBeFocused();
  }

  // Every dismissal returns to the same closed layout, including a fresh load.
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = page.getByRole("dialog", { name: "Product navigation", exact: true });
  const opener = page.getByRole("button", { name: "Search pages, tools, and team data", exact: true });
  await openNav(page);
  await panel.getByRole("button", { name: "Close menu", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();
  await openNav(page);
  await page.getByRole("button", { name: "Close navigation", exact: true }).click({ position: { x: 1200, y: 400 } });
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();
  await openNav(page);
  await page.reload();
  await expect(panel).toBeHidden();
  await expect(opener).toBeVisible();
});
