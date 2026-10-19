import { primaryNavigation, searchOpener } from "./nav";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mainMenuSections } from "../../apps/web/lib/nav/main-menu";
import { PRODUCT_NAV_GROUPS } from "../../apps/web/lib/nav/product-nav";
import { PLACES } from "../../apps/web/lib/nav/places";
import { signInAs } from "./session";

test.use({ actionTimeout: 15_000 });
test.beforeEach(async ({ context }) => { test.setTimeout(180_000); expect(await signInAs(context, "owner")).toBe(true); });
// The five places are the bottom bar on phones and tablets and the sidebar on a computer.
for (const width of [320, 390, 768, 1440]) test(`the five places at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/competition?tab=strategy");
  const places = primaryNavigation(page);
  await expect(places.getByRole("link")).toHaveCount(PLACES.length);
  await expect(places.getByRole("link", { name: "Competition", exact: true })).toHaveAttribute("aria-current", "page");
  const sections = page.getByRole("navigation", { name: "Competition sections", exact: true });
  await expect(sections.getByRole("link", { name: "Match plan", exact: true })).toHaveAttribute("aria-current", "page");
  expect((await new AxeBuilder({ page }).include(width >= 1100 ? ".app-sidebar" : ".soft-island").include(".workspace-hub-sections").analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`places-${width}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [390, 1440]) test(`Home keeps real work easy to reach at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("dash-now").or(page.locator(".dash-widget.hero")).first()).toBeVisible();
  await expect(searchOpener(page)).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`home-${width}.png`), fullPage: true });
  // Scout is two taps from anywhere: Competition, then Scout (one, when it is pinned).
  await primaryNavigation(page).getByRole("link", { name: "Competition", exact: true }).click();
  await page.getByRole("navigation", { name: "Competition sections", exact: true }).getByRole("link", { name: "Scout", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Scout", exact: true })).toBeVisible();
});

test("every section opens from its place and keeps the team", async ({ page }) => {
  test.setTimeout(600_000);
  const orgId = "6925a000-0000-4000-8000-000000000001";
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/dashboard?orgId=${orgId}`);
  for (const section of mainMenuSections(PRODUCT_NAV_GROUPS, () => true)) {
    for (const item of section.items) {
      await primaryNavigation(page).getByRole("link", { name: section.label, exact: true }).click();
      await page.getByRole("navigation", { name: `${section.label} sections`, exact: true }).getByRole("link", { name: item.label, exact: true }).click();
      const destination = new URL(item.href, "http://localhost");
      await expect(page).toHaveURL(url => url.pathname === destination.pathname &&
        [...destination.searchParams].every(([key, value]) => url.searchParams.get(key) === value));
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      expect(new URL(page.url()).searchParams.get("orgId"), item.href).toBe(orgId);
      await page.waitForLoadState("load");
      await expect(page.locator("body")).not.toContainText("Application error");
    }
  }
});

test("sections respect workspace restrictions", async ({ page }) => {
  const me = await (await page.request.get("/api/me")).json();
  await page.route("**/api/me**", route => route.fulfill({ json: { ...me, hubAccess: [{ hubId: "competition", allowedTabIds: ["scouting"] }] } }));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/competition");
  const sections = page.getByRole("navigation", { name: "Competition sections", exact: true });
  // One section left is not a choice: the row is not drawn.
  await expect(sections).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Scout", exact: true })).toBeVisible();
});

test("account and inbox filters remain task controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/account"); const selector = page.getByRole("navigation", { name: "Settings sections", exact: true });
  await selector.getByRole("link", { name: "Appearance", exact: true }).click();
  await expect(selector.getByRole("link", { name: "Appearance", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goto("/notifications"); const filters = page.getByRole("combobox", { name: "Inbox filters", exact: true });
  await filters.selectOption("unread"); await expect(filters).toHaveValue("unread");
});

for (const width of [390, 1440]) test(`search changes the open AI and scouting task at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const orgId = "6925a000-0000-4000-8000-000000000001";
  await page.goto(`/ai?tab=writer&orgId=${orgId}`);
  await expect(page.getByLabel("What are you writing?")).toBeVisible({ timeout: 30_000 });
  await searchOpener(page).click();
  await page.getByRole("combobox", { name: "Search pages, tools, and your team's data, or ask AI", exact: true }).fill("Connect AI");
  await page.getByRole("option", { name: "Connect AI AI › Controls", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect AI", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("orgId")).toBe(orgId);
  await expect(page.locator(".ai-connect-method")).toHaveCount(2);
  await page.goto(`/competition?tab=scouting&orgId=${orgId}`);
  await expect(page.getByRole("heading", { name: "Scout", exact: true })).toBeVisible();
  await searchOpener(page).click();
  const search = page.getByRole("combobox", { name: "Search pages, tools, and your team's data, or ask AI", exact: true });
  await search.fill("Teams");
  await expect(page.getByRole("option", { name: "Teams Competition", exact: true })).toBeVisible();
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
  await expect(page.locator(".stp-row").first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sort robots", exact: true })).toBeEnabled();
  await expect(searchOpener(page)).toHaveAttribute("aria-expanded", "false");
});
