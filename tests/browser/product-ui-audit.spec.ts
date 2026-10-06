import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { PRODUCT_HUBS, hubHref } from "../../apps/web/lib/nav/hubs";
import { signInAs } from "./session";
import { waitForLoadingGone } from "./ready";

// Full route census is opt-in: functional stories run separately. A route
// painting correctly does not prove that its writes or integrations work.
test("all registered workspaces have accessible, responsive presentation", async ({ page, context }, info) => {
  test.skip(process.env.PRODUCT_UI_AUDIT !== "1", "Set PRODUCT_UI_AUDIT=1 for the full presentation census.");
  test.setTimeout(1_800_000);
  expect(await signInAs(context, "owner")).toBe(true);
  const orgId = (await (await context.request.get("/api/me")).json()).orgId;
  const width = Number(process.env.PRODUCT_UI_WIDTH ?? 1440);
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: process.env.PRODUCT_UI_DARK === "1" ? "dark" : "light", reducedMotion: "reduce" });
  const routes = [...new Set([
    "/dashboard", "/account", "/account/teams", "/team/admin", "/onboarding", "/claim", "/help", "/privacy", "/terms",
    ...PRODUCT_HUBS.filter(hub => hub.id !== "media").flatMap(hub => hub.tabs.map(tab => hubHref(hub.href, tab.id, orgId))),
  ])];
  const audit: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  let errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const out = process.env.PRODUCT_UI_OUT ?? info.outputPath("census");
  mkdirSync(out, { recursive: true });
  for (const [index, route] of routes.entries()) {
    errors = [];
    const row: Record<string, unknown> = { route, width };
    try {
      const response = await page.goto(route, { timeout: 60_000 });
      row.status = response?.status();
      await waitForLoadingGone(page);
      // Wait for real fetch-driven surfaces, including those using an inline
      // loading label rather than the shared loading heading.
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        title: document.querySelector("main h1")?.textContent?.trim(),
        missing: /This page is not here|Application error/.test(document.body.innerText),
      }));
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const violations = result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, issue: n.failureSummary })) }));
      Object.assign(row, layout, { url: new URL(page.url()).pathname + new URL(page.url()).search, errors: [...errors], violations });
      if ((response?.status() ?? 500) >= 400 || layout.overflow || layout.missing || errors.length || violations.length || new URL(page.url()).pathname === "/signin") failures.push(row);
      await page.screenshot({ path: `${out}/${String(index).padStart(3, "0")}-${new URL(route, "http://local").pathname.replace(/\W/g, "")}-${new URL(route, "http://local").searchParams.get("tab") ?? "root"}.png` });
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
      failures.push(row);
    }
    audit.push(row);
    writeFileSync(`${out}/audit.json`, JSON.stringify({ routes: audit, failures }, null, 2));
    if ((index + 1) % 20 === 0) console.log(`Presentation census: ${index + 1}/${routes.length}; ${failures.length} findings`);
  }
  await info.attach("presentation-census", { path: `${out}/audit.json`, contentType: "application/json" });
  expect(failures).toEqual([]);
});
