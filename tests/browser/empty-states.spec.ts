import { expect, test, type Page } from "@playwright/test";
import { signInFixture } from "./session";

/**
 * The seams wired in this round, exercised end to end rather than widget by
 * widget: the no-org screens that used to be a bare <h1>, the theme cookie the
 * provider must not invent, the cross-links that appeared twice on one page,
 * and Business's markup order around its own tab bar.
 */

test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

/**
 * Reachable org-gated routes. /cad, /team/ai-hub, /team/ai-memory and
 * /team/ai-policy used to be here and are gone for good: LEGACY_HUB_REDIRECTS
 * sends all four to a hub tab before the page can run, so their page.tsx files
 * were unreachable markup and have been deleted. The clients three of them
 * mounted are still alive — the /ai and /build hubs import them directly.
 */
const NO_ORG_ROUTES = [
  { path: "/showcase", crumb: "Media / Showcase", heading: "Showcase" },
  { path: "/team/ai-runs", crumb: "Team / AI Runs", heading: "AI Runs" },
  { path: "/team/audit", crumb: "Team / Audit", heading: "Audit" },
  { path: "/team/getting-started", crumb: "Team / Getting started", heading: "Getting started" },
  { path: "/team/knowledge/history", crumb: "Knowledge / History", heading: "Knowledge history" },
  { path: "/team/posture", crumb: "Team / Posture", heading: "Security posture" },
  { path: "/team/prompts", crumb: "Team / Prompts", heading: "Prompts" },
  { path: "/team/security", crumb: "Team / Security", heading: "Team security" },
  { path: "/team/security/exports", crumb: "Security / Exports", heading: "Export audit" },
];

for (const route of NO_ORG_ROUTES) {
  test(`${route.path} without an org offers a way to pick one`, async ({ page }) => {
    await page.goto(route.path);
    const main = page.locator("#main-content");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(route.heading);
    await expect(main.locator(".breadcrumbs")).toHaveText(route.crumb);
    await expect(main.getByRole("heading", { level: 2, name: "Choose your team" })).toBeVisible();

    // The action has to go somewhere real, not just say the word "team".
    const choose = main.getByRole("link", { name: "Choose your team" });
    await expect(choose).toHaveAttribute("href", "/workspace");
    await choose.click();
    // /workspace picks the team for real sessions. Under E2E_AUTH_FIXTURE there
    // is no Better Auth session behind the cookie, so it bounces
    // /workspace → /signin → /dashboard; what this asserts is that the link
    // resolves and leaves the dead end, not which door the fixture ends at.
    await expect(page).not.toHaveURL(new RegExp(`${route.path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("no-org screens are never a bare heading with nothing to click", async ({ page }) => {
  for (const route of NO_ORG_ROUTES) {
    await page.goto(route.path);
    const controls = page.locator("#main-content a[href], #main-content button");
    expect(await controls.count(), `${route.path} has no next step`).toBeGreaterThan(0);
  }
});

/** Everything the theme provider may have written for this origin. */
async function themeCookies(page: Page) {
  const cookies = await page.context().cookies();
  return Object.fromEntries(
    cookies
      .filter((cookie) => cookie.name.startsWith("vantage-theme"))
      .map((cookie) => [cookie.name, cookie.value]),
  );
}

test("a browser that has never chosen a theme is not given one", async ({ page }) => {
  // The bug: /api/theme answering `persisted: false` still ran applyPreference(),
  // and with nothing in storage the fallback "light" was written to
  // vantage-theme-pref — a preference the user never expressed. The boot script
  // reads that cookie ahead of localStorage, so the invented default then
  // outranked a real choice made later on another device.
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveClass(/theme-ready/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  expect(await themeCookies(page)).toEqual({});
  expect(
    await page.evaluate(() => localStorage.getItem("vantage-theme-pref")),
  ).toBeNull();
});

test("a theme chosen while /api/theme is in flight survives the response", async ({ page }) => {
  // The other half of the same bug: the response handler closed over the
  // preference read before the request went out, so picking Dark from Account →
  // Appearance during the round trip was silently stamped back to the old
  // value. Hold the response open, choose in the gap, then let it land.
  let requested = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/theme", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    requested = true;
    await gate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ theme: "light", persisted: false }),
    });
  });

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect.poll(() => requested, { timeout: 15000 }).toBe(true);

  // Exactly what the Appearance control writes before it PUTs.
  await page.evaluate(() => {
    localStorage.setItem("vantage-theme-pref", "dark");
    document.cookie = "vantage-theme-pref=dark; Path=/; Max-Age=31536000; SameSite=Lax";
  });
  release();

  await expect(page.locator("html")).toHaveClass(/theme-ready/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(async () => (await themeCookies(page))["vantage-theme-pref"]).toBe("dark");
});

/** Distinct destinations behind one visible label, and vice versa. */
async function linkIndex(page: Page) {
  // `.settings-bar` is the cross-page settings nav, shared by every settings
  // surface and owned elsewhere. On /account its Personal chips point back at
  // this page's own tabs ("My AI keys" vs the strip's "AI keys", Profile /
  // Appearance / Notifications vs the tab bar) — a real overlap, but one that
  // has to be fixed in the bar, not in the pages that mount it.
  return page.locator("#main-content a[href]:not(.settings-bar a)").evaluateAll((nodes) => {
    const byHref: Record<string, string[]> = {};
    const byLabel: Record<string, string[]> = {};
    for (const node of nodes) {
      const el = node as HTMLAnchorElement;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const label = (el.textContent || "").replace(/\s+/g, " ").trim();
      // "Open" is the Next-actions list's own affordance: one row per reason,
      // each with its own destination. Counting it as a duplicate label would
      // be counting the list itself.
      if (!label || label === "Open") continue;
      const href = el.getAttribute("href") || "";
      (byHref[href] ??= []).push(label);
      (byLabel[label] ??= []).push(href);
    }
    return { byHref, byLabel };
  });
}

const CROSS_LINK_PAGES = ["/notifications", "/whats-new", "/account"];

for (const path of CROSS_LINK_PAGES) {
  test(`${path} links each destination once, under one name`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const { byHref, byLabel } = await linkIndex(page);

    const repeatedHrefs = Object.entries(byHref).filter(([, labels]) => labels.length > 1);
    expect(repeatedHrefs, `${path} repeats a destination`).toEqual([]);

    const splitLabels = Object.entries(byLabel).filter(
      ([, hrefs]) => new Set(hrefs).size > 1,
    );
    expect(splitLabels, `${path} uses one name for two destinations`).toEqual([]);
  });
}

test("business keeps its tab bar above whatever it has to tell you", async ({ page }) => {
  // A failed load is the reachable version of the same markup order: the card
  // used to render above the tab bar, so anything going wrong pushed Business's
  // own navigation down the page.
  await page.route("**/api/business?*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"nope"}' }),
  );
  await page.goto("/business");

  const tabs = page.locator("#main-content [role='tablist']").first();
  await expect(tabs).toBeVisible();
  const card = page.locator("#main-content .soft-empty, #main-content .biz-alert").first();
  await expect(card).toBeVisible();

  const tabsFirst = await page.evaluate(() => {
    const list = document.querySelector("#main-content [role='tablist']");
    const notice = document.querySelector("#main-content .soft-empty, #main-content .biz-alert");
    if (!list || !notice) return null;
    return (list.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  expect(tabsFirst).toBe(true);
});
