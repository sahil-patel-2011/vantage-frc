import { navigationOpener } from "./nav";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mainMenuSections } from "../../apps/web/lib/nav/main-menu";
import { PRODUCT_NAV_GROUPS } from "../../apps/web/lib/nav/product-nav";
import { signInAs } from "./session";

test.use({ actionTimeout: 15_000 });
test.beforeEach(async ({ context }) => { test.setTimeout(180_000); expect(await signInAs(context, "owner")).toBe(true); });
for (const width of [320, 390, 768, 1440]) test(`one destination menu at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/ai?tab=writer");
  await expect(page.getByLabel("What are you writing?")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "AI section", exact: true })).toHaveCount(0);
  const menu = navigationOpener(page);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  const nav = page.getByRole("navigation", { name: "Main menu", exact: true });
  await expect(nav.getByRole("link", { name: /^Home/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Scouting/ })).toBeVisible();
  const ai = nav.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^AI$/ }) });
  await ai.locator("summary").focus(); await page.keyboard.press("Enter");
  await expect(ai.getByRole("link", { name: "Writer", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".soft-drawer").analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`menu-${width}.png`) });
  await page.keyboard.press("Escape"); await expect(menu).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [390, 1440]) test(`Home keeps real work easy to reach at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("dash-now").or(page.locator(".dash-widget.hero")).first()).toBeVisible();
  await expect(navigationOpener(page)).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`home-${width}.png`), fullPage: true });
  await navigationOpener(page).click();
  await page.getByRole("navigation", { name: "Main menu", exact: true }).getByRole("link", { name: /^Scouting/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Scout", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Competition section", exact: true })).toHaveCount(0);
});

test("every grouped destination opens from the menu and keeps the team", async ({ page }) => {
  test.setTimeout(600_000);
  const orgId = "6925a000-0000-4000-8000-000000000001";
  await page.goto(`/dashboard?orgId=${orgId}`);
  for (const section of mainMenuSections(PRODUCT_NAV_GROUPS, () => true)) {
    for (const item of section.items) {
      await navigationOpener(page).click();
      const group = page.getByRole("navigation", { name: "Main menu", exact: true }).locator("details").filter({ has: page.locator("summary").filter({ hasText: section.label }) });
      await group.locator("summary").click();
      await group.getByRole("link", { name: item.label, exact: true }).click();
      const destination = new URL(item.href, "http://localhost");
      await expect(page).toHaveURL(url => url.pathname === destination.pathname &&
        [...destination.searchParams].every(([key, value]) => url.searchParams.get(key) === value));
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      expect(new URL(page.url()).searchParams.get("orgId"), item.href).toBe(orgId);
      await expect(navigationOpener(page)).toHaveAttribute("aria-expanded", "false");
      await page.waitForLoadState("load");
      await expect(page.locator("body")).not.toContainText("Application error");
    }
  }
});

test("menu destinations respect workspace and sponsor restrictions", async ({ page }) => {
  const me = await (await page.request.get("/api/me")).json();
  await page.route("**/api/me**", route => route.fulfill({ json: { ...me, hubAccess: [{ hubId: "ai", allowedTabIds: ["chat"] }] } }));
  await page.goto("/ai"); await navigationOpener(page).click();
  const ai = page.getByRole("navigation", { name: "AI", exact: true });
  await page.locator(".main-menu-section > summary").filter({ hasText: /^AI$/ }).click();
  await expect(ai.getByRole("link", { name: "Chat", exact: true })).toBeVisible();
  await expect(ai.getByRole("link", { name: "Writer", exact: true })).toHaveCount(0);
});

test("account and inbox filters remain task controls", async ({ page }) => {
  await page.goto("/account"); const selector = page.getByRole("tablist", { name: "Account sections", exact: true });
  await selector.getByRole("tab", { name: "Appearance", exact: true }).click();
  await expect(selector.getByRole("tab", { name: "Appearance", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.goto("/notifications"); const filters = page.getByRole("combobox", { name: "Inbox filters", exact: true });
  await filters.selectOption("unread"); await expect(filters).toHaveValue("unread");
});

for (const width of [390, 1440]) test(`search changes the open AI and scouting task at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const orgId = "6925a000-0000-4000-8000-000000000001";
  await page.goto(`/ai?tab=writer&orgId=${orgId}`);
  await expect(page.getByLabel("What are you writing?")).toBeVisible({ timeout: 30_000 });
  await navigationOpener(page).click();
  await page.getByRole("combobox", { name: "Search pages, tools, and your team's data", exact: true }).fill("Connect AI");
  await page.getByRole("option", { name: "Connect AI AI › Controls", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect AI", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("orgId")).toBe(orgId);
  await expect(page.locator(".ai-connect-method")).toHaveCount(2);
  await page.goto(`/competition?tab=scouting&orgId=${orgId}`);
  await expect(page.getByRole("heading", { name: "Scout", exact: true })).toBeVisible();
  await navigationOpener(page).click();
  const search = page.getByRole("combobox", { name: "Search pages, tools, and your team's data", exact: true });
  await search.fill("Teams");
  await expect(page.getByRole("option", { name: "Teams Competition", exact: true })).toBeVisible();
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
  await expect(page.locator(".stp-row").first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sort robots", exact: true })).toBeEnabled();
  await expect(navigationOpener(page)).toHaveAttribute("aria-expanded", "false");
});
