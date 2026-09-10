import { expect, test, type Page } from "@playwright/test";
import { hubById, hubPrimaryTabs } from "../../apps/web/lib/nav/hubs";
import { signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

/** Links a page renders in its own body — the shell's nav is not part of this. */
async function bodyLinks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...(document.querySelector("main") ?? document.body).querySelectorAll("a[href]")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/")),
  );
}

function hrefMatchesTarget(href: string, target: string): boolean {
  const [hrefPath, hrefQuery] = href.split("?");
  const [targetPath, targetQuery] = target.split("?");
  if (hrefPath !== targetPath) return false;
  if (!targetQuery) return true;
  const want = new URLSearchParams(targetQuery);
  const have = new URLSearchParams(hrefQuery ?? "");
  for (const [key, value] of want.entries()) {
    if (key === "orgId") continue;
    if (have.get(key) !== value) return false;
  }
  return true;
}

test.describe("one control per destination", () => {
  /**
   * `/logistics` rendered LogisticsRelated twice on the same screen — once in the
   * page header and again inside the empty state — so Event Day / My Day /
   * Team calendar / Visit invites each appeared as two separate buttons.
   */
  test("team admin offers each related destination once", async ({ page }) => {
    await page.goto("/team/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Team admin" })).toBeVisible();
    const main = page.locator("main");
    for (const label of ["Account", "Discord", "Account Connections"]) {
      await expect(main.getByRole("link", { name: label, exact: true })).toHaveCount(1);
    }
    await expect(main.getByRole("link", { name: "Choose your team", exact: true })).toHaveCount(1);
    await expect(main.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  });

  test("logistics offers each related destination once", async ({ page }) => {
    await page.goto("/logistics");
    await expect(page.getByRole("heading", { level: 1, name: "Logistics" })).toBeVisible();
    const main = page.locator("main");
    for (const label of ["Event Day", "My Day", "Team calendar", "Visit invites", "Packing"]) {
      await expect(main.getByRole("link", { name: label, exact: true })).toHaveCount(1);
    }
    const links = await bodyLinks(page);
    expect(new Set(links).size, `duplicate hrefs in body: ${links.join(" ")}`).toBe(links.length);
  });

  /**
   * The Media header strip carried Media Kit and Community Impact, both of which
   * the page owns as its own tabs — and its "Community Impact" pointed at the
   * Business tab while the Impact panel's button pointed at /impact.
   */
  test("media header links only to destinations the page does not own", async ({ page }) => {
    await page.goto("/media");
    await expect(page.getByRole("heading", { level: 1, name: "Media" })).toBeVisible();
    const strip = page.locator('nav[aria-label="Related media tools"]');
    await expect(strip.getByRole("link")).toHaveCount(2);
    await expect(strip.getByRole("link", { name: "Media Kit" })).toHaveCount(0);
    await expect(strip.getByRole("link", { name: "Community Impact" })).toHaveCount(0);
    await expect(strip.getByRole("link", { name: "Outreach Calendar" })).toBeVisible();
    // Media Kit is still reachable, but as the shell's own primary action rather
    // than a second header button aimed at the same page. Which shell renders
    // depends on whether the workspace has media rows, so assert only that no
    // state offers it twice.
    await expect(page.locator("main").getByRole("link", { name: /Media Kit/ })).not.toHaveCount(2);
  });
});

test.describe("workflow handoffs", () => {
  /**
   * Each of these pages was an island: it recorded something the next step in the
   * same job needs and offered no way to get there.
   */
  const HANDOFFS = [
    { path: "/spares", heading: /Consumables/i, links: ["/orders", "/packing"] },
    { path: "/incidents", heading: /Safety Incident Log/i, links: ["/safety", "/build?tab=fmea"] },
    { path: "/packing", heading: /Packing Lists/i, links: ["/spares", "/logistics", "/event-readiness"] },
    { path: "/files", heading: /^Files$/, links: ["/team?tab=knowledge", "/team?tab=messages", "/build?tab=cad"] },
  ] as const;

  for (const handoff of HANDOFFS) {
    test(`${handoff.path} reaches the next step in its own workflow`, async ({ page }) => {
      await page.goto(handoff.path);
      await expect(page.getByRole("heading", { level: 1, name: handoff.heading })).toBeVisible();
      const links = await bodyLinks(page);
      for (const target of handoff.links) {
        expect(
          links.some((href) => hrefMatchesTarget(href, target)),
          `${handoff.path} should link to ${target}; body links were ${links.join(" ")}`,
        ).toBe(true);
      }
    });
  }

  test("inspection copilot hands off to weigh-in", async ({ page }) => {
    await page.goto("/inspection-copilot");
    await expect(
      page.getByRole("heading", { level: 1, name: "Inspection-Readiness Copilot" }),
    ).toBeVisible();
    const links = await bodyLinks(page);
    expect(
      links.some((href) => hrefMatchesTarget(href, "/build?tab=robot-weigh-in")),
      `inspection-copilot should link to weigh-in; body links were ${links.join(" ")}`,
    ).toBe(true);
  });

  test("every workflow handoff target resolves", async ({ page, request }) => {
    const targets = [
      "/orders",
      "/packing",
      "/safety",
      "/build",
      "/robot-weigh-in",
      "/inspection-copilot",
      "/logistics",
      "/spares",
      "/event-readiness",
      "/files",
    ];
    for (const target of targets) {
      const response = await request.get(target);
      expect(response.status(), `${target} status`).toBeLessThan(400);
    }
    await page.goto("/showcase");
    // Was a bare <h1> with nothing to click.
    await expect(page.getByRole("link", { name: "Choose team" })).toBeVisible();
  });
});

test.describe("hub chrome", () => {
  const HUBS = ["competition", "team", "business", "build", "ai"] as const;

  /**
   * The tab bar names the workbench; the tool strip lists what is *inside* it.
   * `/media` and `/business` built their own strips off hubNestedTabs(), which
   * leads with the workbench root — so the open workbench was printed twice.
   */
  for (const hubId of HUBS) {
    test(`${hubId} tool strip never repeats the open workbench`, async ({ page }) => {
      const hub = hubById(hubId);
      await page.goto(hub.href, { waitUntil: "domcontentloaded" });
      const selected = page.getByRole("tab", { selected: true });
      await expect(selected).toHaveCount(1, { timeout: 15_000 });
      const label = (await selected.textContent())?.trim() ?? "";
      expect(label).not.toBe("");
      const strip = page.locator(".hub-tool-strip");
      if ((await strip.count()) === 0) return;
      await expect(strip.getByText(label, { exact: true })).toHaveCount(0);
    });
  }

  test("hub tab bars list every workbench exactly once", async ({ page }) => {
    for (const hubId of HUBS) {
      const hub = hubById(hubId);
      await page.goto(hub.href, { waitUntil: "domcontentloaded" });
      const tabs = page.getByRole("tablist").first().getByRole("tab");
      await expect(tabs.first()).toBeVisible({ timeout: 15_000 });
      const labels = (await tabs.allTextContents()).map((text) => text.trim());
      expect(new Set(labels).size, `${hubId} repeats a tab: ${labels.join(", ")}`).toBe(labels.length);
      // Access filtering can hide workbenches, never invent them.
      const known = new Set(hubPrimaryTabs(hub).map((tab) => tab.label));
      for (const label of labels) expect(known.has(label), `${hubId} tab ${label}`).toBe(true);
    }
  });
});
