/**
 * The GUI test agent.
 *
 * Walks every product surface in a real owner session and produces one report
 * that answers three separate questions, which a screenshot never answers:
 *
 *   1. CENSUS   — does each surface render, with no 5xx, no uncaught error, no
 *                 horizontal overflow, no unnamed control, no axe violation, and
 *                 how many controls does it put in front of the user?
 *   2. REACH    — starting at Home with no URL bar, how many clicks does it take
 *                 to open each workspace and each workbench, and does every
 *                 advertised destination actually resolve?
 *   3. LEDGER   — the button census, ranked, so consolidation targets the pages
 *                 that actually cost the user attention instead of the ones that
 *                 happen to be easy to measure.
 *
 * The report is written incrementally so an interrupted run is visibly
 * incomplete rather than silently short. Nothing here calls a page "working"
 * because it rendered: `functionalAcceptance` stays `not-tested` on every row,
 * which is what keeps this from being mistaken for acceptance evidence.
 *
 * Opt in with GUI_AUDIT=1. Requires an isolated, seeded local database — see
 * scripts/start-gui-audit.mjs, which also refuses non-loopback origins.
 */
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PRODUCT_HUBS, hubPrimaryTabs, hubNestedTabs, hubStripTabs } from "../../apps/web/lib/nav/hubs";
import { PRODUCT_NAV_GROUPS, withOrgHref } from "../../apps/web/lib/nav/product-nav";
import { signInAs } from "./session";

const ROOT = join(__dirname, "../..");
const OUT = process.env.GUI_AUDIT_OUT ?? join(ROOT, "audit-artifacts/gui-audit");
const EXCLUDED = new Set(["api", "win-kit", "lovat-kit", "agent-kit", "vantage-scan", "node_modules"]);

function pageRoutes(directory: string, segments: string[] = []): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (EXCLUDED.has(entry.name)) return [];
    if (entry.isDirectory()) return pageRoutes(join(directory, entry.name), [...segments, entry.name]);
    if (entry.name !== "page.tsx" && entry.name !== "page.ts") return [];
    return [`/${segments.filter((segment) => !segment.startsWith("(")).join("/")}`];
  });
}

/**
 * The universe, in the order a person meets it: the five workspaces, then each
 * hub's workbenches, then the nested tools, then standalone pages that no hub
 * lists. A hub tab that renders inline is addressed as `?tab=`; one that lives
 * on its own route is addressed by that route, because that is the URL a person
 * would actually be given.
 */
function buildUniverse(): string[] {
  const routes: string[] = [];
  for (const group of PRODUCT_NAV_GROUPS) routes.push(group.items[0]!.href);
  for (const hub of PRODUCT_HUBS) {
    routes.push(hub.href);
    for (const workbench of hubPrimaryTabs(hub)) {
      routes.push(`${hub.href}?tab=${workbench.id}`);
      for (const tool of hubStripTabs(hub, workbench.id)) {
        routes.push(tool.legacyHref ?? `${hub.href}?tab=${tool.id}`);
      }
    }
  }
  // Workbench tools the strip hides still have pages; they are reachable from
  // search, so they are in scope even though they are not chips.
  for (const hub of PRODUCT_HUBS) {
    for (const workbench of hubPrimaryTabs(hub)) {
      for (const tool of hubNestedTabs(hub, workbench.id)) {
        if (tool.legacyHref) routes.push(tool.legacyHref);
      }
    }
  }
  for (const route of pageRoutes(join(ROOT, "apps/web/app"))) {
    if (route === "/" || route.includes("[")) continue;
    routes.push(route);
  }
  // Strip the fragments that only address a state, and the pages a signed-in
  // team member never sees. The platform console is one of those: a team owner
  // is refused it on purpose, and a 403 there is the product working, so it is
  // listed as out of scope rather than as a surface that failed.
  const HIDDEN_IN_APP = new Set(["/terms", "/privacy", "/cost", "/for-teams", "/how-it-works", "/features"]);
  const seen = new Set<string>();
  return routes.filter((route) => {
    const clean = route.split("#")[0]!.split("?")[0]!;
    if (!clean || clean === "/" || clean === "/admin" || clean.startsWith("/admin/")) return false;
    if (HIDDEN_IN_APP.has(clean)) return false;
    if (seen.has(route)) return false;
    seen.add(route);
    return true;
  }).sort();
}

/** Pages this session is not entitled to, recorded so they are not silently dropped. */
const OUT_OF_SCOPE = [
  { href: "/admin", reason: "platform console; a team owner is refused by design" },
  { href: "/admin/analytics", reason: "platform console; a team owner is refused by design" },
  { href: "/admin/audit", reason: "platform console; a team owner is refused by design" },
  { href: "/admin/commercial", reason: "platform console; a team owner is refused by design" },
  { href: "/admin/connectors", reason: "platform console; a team owner is refused by design" },
];

const UNIVERSE = buildUniverse();

type Control = {
  tag: string;
  role: string | null;
  name: string;
  href: string | null;
  disabled: boolean;
  inViewport: boolean;
  /** Inside a disclosure that is closed, or inside a hidden overflow menu. */
  disclosed: boolean;
};

type Row = {
  route: string;
  width: number;
  status: number | null;
  destination: string;
  disposition: "rendered" | "unsettled" | "failed" | "setup-or-unavailable" | "not-run";
  settled: boolean;
  overflow: boolean;
  controls: number;
  buttons: number;
  inViewportControls: number;
  names: { missing: number; duplicated: number; examples: string[] };
  axe: string[];
  runtime: Array<{ kind: string; message: string }>;
  headings: string[];
  textLength: number;
  elapsedMs: number;
  screenshot?: string;
  error?: string;
  functionalAcceptance: "not-tested";
  controlInventory?: Control[];
  expandedInventory?: Control[];
  disclosuresTested?: number;
};

/** One in-page census. Runs in the page so it sees the rendered tree, not the source. */
async function census(page: Page): Promise<Omit<Row, "route" | "width" | "status" | "destination" | "disposition" | "elapsedMs" | "screenshot" | "error" | "runtime" | "functionalAcceptance">> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (el.closest("[inert]") || el.closest("[aria-hidden='true']")) return false;
      const closed = el.closest("details:not([open])");
      if (closed && !closed.querySelector(":scope > summary")?.contains(el)) return false;
      return true;
    };
    const name = (el: Element) => {
      const labelled = el.getAttribute("aria-label")?.trim();
      if (labelled) return labelled;
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter(Boolean).join(" ");
        if (text) return text;
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        if (el.labels?.length) return el.labels[0]!.textContent?.trim() ?? "";
        if (el.getAttribute("title")) return el.getAttribute("title")!;
        return "";
      }
      if (el.tagName === "A" || el.tagName === "BUTTON" || el.tagName === "SUMMARY") {
        return el.textContent?.trim().replace(/\s+/g, " ") ?? "";
      }
      return el.getAttribute("title")?.trim() ?? "";
    };
    const selector = "button,a[href],input,select,textarea,summary,[role='button'],[role='tab']";
    const all = [...document.querySelectorAll(selector)].filter((el) => !el.closest("nextjs-portal"));
    const controls: Control[] = all.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        name: name(el),
        href: el.getAttribute("href"),
        disabled: (el as HTMLButtonElement).disabled === true,
        inViewport: rect.top < innerHeight && rect.bottom > 0,
        disclosed: !visible(el),
      };
    });
    const live = controls.filter((control) => !control.disclosed);
    const tally = new Map<string, number>();
    for (const control of live) {
      const key = control.name.toLocaleLowerCase().replace(/\s+/g, " ");
      if (!key) continue;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const missing = live.filter((control) => !control.name.trim()).length;
    const duplicated = [...tally.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
    const main = document.querySelector("main") ?? document.body;
    return {
      settled: true,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      controls: live.length,
      buttons: live.filter((control) => control.tag === "button" || control.tag === "summary" || control.role === "button" || control.role === "tab").length,
      inViewportControls: live.filter((control) => control.inViewport).length,
      names: {
        missing,
        duplicated,
        examples: [...tally.entries()].filter(([, count]) => count > 1).map(([key]) => key).slice(0, 6),
      },
      axe: [] as string[],
      headings: [...main.querySelectorAll("h1,h2")].filter(visible).map((el) => el.textContent?.trim() ?? "").slice(0, 12),
      textLength: (main as HTMLElement).innerText.length,
      controlInventory: controls,
    };
  });
}

/** A surface counts as settled when nothing is still busy and the panel has content. */
async function settled(page: Page): Promise<boolean> {
  return page.waitForFunction(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const busy = [...document.querySelectorAll('[aria-busy="true"]')].some(visible);
    const panel = document.querySelector(".product-hub-panel");
    const filled = !panel || (panel.textContent?.trim().length ?? 0) > 30;
    return !busy && filled;
  }, undefined, { timeout: 20_000 }).then(() => true, () => false);
}

async function writeReport(name: string, payload: unknown) {
  mkdirSync(OUT, { recursive: true });
  // Windows readers can briefly hold the report while a progress check reads it.
  for (let attempt = 0; ; attempt++) {
    try { writeFileSync(join(OUT, name), JSON.stringify(payload, null, 2)); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !["UNKNOWN", "EPERM", "EBUSY", "EACCES"].includes(code ?? "")) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

function sharded<T>(items: T[], offset = 0, limit = items.length): T[] {
  return items.slice(offset, offset + limit);
}

test.describe("GUI test agent", () => {
  test.skip(process.env.GUI_AUDIT !== "1", "Opt-in measured GUI audit; requires isolated seeded data.");
  test.describe.configure({ mode: "serial" });

  test("census every product surface", async ({ page, context }, info) => {
    test.setTimeout(Number(process.env.GUI_AUDIT_TIMEOUT ?? 90) * 60_000);
    expect(await signInAs(context, "owner"), "A real owner session is mandatory; no proxy fallback").toBe(true);

    const me = await context.request.get("/api/me");
    expect(me.ok()).toBe(true);
    const identity = await me.json();
    expect(identity.orgId, "The audit account must belong to a team").toBeTruthy();

    const offset = Number(process.env.GUI_AUDIT_START ?? 0);
    const limit = Number(process.env.GUI_AUDIT_LIMIT ?? UNIVERSE.length);
    const requested: string[] | null = process.env.GUI_AUDIT_ROUTES ? JSON.parse(process.env.GUI_AUDIT_ROUTES) : null;
    if (requested) expect(requested.filter(route => !UNIVERSE.includes(route)), "Targeted routes must be in the full audit inventory").toEqual([]);
    const routes = requested ? UNIVERSE.filter(route => requested.includes(route)) : sharded(UNIVERSE, offset, limit);
    const widths = (process.env.GUI_AUDIT_WIDTHS ?? "1440,390").split(",").map(Number);
    const withAxe = process.env.GUI_AUDIT_AXE === "1";

    const rows: Row[] = [];
    const runtime: Array<{ route: string; kind: string; message: string }> = [];
    let current = "";
    page.on("pageerror", (error) => runtime.push({ route: current, kind: "pageerror", message: error.message }));
    page.on("response", (response) => {
      if (response.status() < 500) return;
      try {
        if (new URL(response.url()).origin !== new URL(page.url()).origin) return;
      } catch { return; }
      runtime.push({ route: current, kind: "http", message: `${response.status()} ${new URL(response.url()).pathname}` });
    });

    const expected = routes.filter((route) => !route.includes("[")).length * widths.length;
    const save = (complete: boolean) => writeReport("census.json", {
      schemaVersion: 2,
      complete,
      scope: { universe: UNIVERSE.length, offset, limit, widths, axe: withAxe },
      identity: { orgId: identity.orgId, teamNumber: identity.teamNumber, role: identity.role },
      planned: routes,
      outOfScope: OUT_OF_SCOPE,
      rows,
      runtime,
    });

    await save(false);
    for (const route of routes) {
      if (route.includes("[")) {
        rows.push({ route, width: 0, status: null, destination: route, disposition: "not-run", settled: false, overflow: false, controls: 0, buttons: 0, inViewportControls: 0, names: { missing: 0, duplicated: 0, examples: [] }, axe: [], runtime: [], headings: [], textLength: 0, elapsedMs: 0, functionalAcceptance: "not-tested" });
        continue;
      }
      for (const width of widths) {
        current = route;
        await page.setViewportSize({ width, height: 900 });
        const errorsBefore = runtime.length;
        const started = Date.now();
        try {
          const response = await page.goto(withOrgHref(route, identity.orgId), { waitUntil: "domcontentloaded", timeout: 90_000 });
          const isSettled = await settled(page);
          await page.waitForTimeout(500);
          const measured = await census(page);
          let expandedInventory: Control[] | undefined;
          let disclosuresTested = 0;
          if (process.env.GUI_AUDIT_DISCLOSURES === "1") {
            const disclosures = page.locator("main details");
            for (let index = 0; index < await disclosures.count(); index++) {
              const disclosure = disclosures.nth(index);
              const summary = disclosure.locator(":scope > summary");
              if (await summary.isVisible() && !await disclosure.getAttribute("open").then(value => value !== null)) {
                await summary.press("Enter");
                await expect(disclosure).toHaveAttribute("open");
                disclosuresTested++;
              }
            }
            expandedInventory = (await census(page)).controlInventory;
            for (let index = await disclosures.count() - 1; index >= 0; index--) {
              const disclosure = disclosures.nth(index);
              if (await disclosure.getAttribute("open") !== null) await disclosure.locator(":scope > summary").press("Enter");
            }
          }
          const destination = new URL(page.url());
          const text = await page.evaluate(() => (document.querySelector("main") ?? document.body).innerText.slice(0, 6000));
          const authWall = /\/(signin|onboarding)$/.test(destination.pathname);
          const crash = /Application error|This page is not here|Could not load|Couldn't load|Couldn’t load|Something went wrong/i.test(text);
          const setup = /Needs setup|Needs a link|Choose your team|Ask a mentor|not configured|temporarily unavailable|not available right now|setup_required/i.test(text);
          let axe: string[] = [];
          if (withAxe) {
            try {
              const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
              axe = result.violations.map((violation) => `${violation.id} (${violation.nodes.length}×) — ${violation.help}`);
            } catch (error) {
              axe = [`axe failed: ${error instanceof Error ? error.message : String(error)}`];
            }
          }
          const shot = info.outputPath(`${width}-${rows.length}.png`);
          await page.screenshot({ path: shot, fullPage: false, timeout: 20_000 }).catch(() => {});
          rows.push({
            route, width,
            status: response?.status() ?? null,
            destination: `${destination.pathname}${destination.search}`,
            disposition: authWall || crash || (response?.status() ?? 0) >= 400 ? "failed" : !isSettled ? "unsettled" : setup ? "setup-or-unavailable" : "rendered",
            settled: isSettled,
            ...measured,
            axe,
            runtime: runtime.slice(errorsBefore).map(({ kind, message }) => ({ kind, message })),
            elapsedMs: Date.now() - started,
            screenshot: shot,
            functionalAcceptance: "not-tested",
            expandedInventory, disclosuresTested,
          });
        } catch (error) {
          rows.push({
            route, width, status: null, destination: route, disposition: "failed", settled: false, overflow: false,
            controls: 0, buttons: 0, inViewportControls: 0, names: { missing: 0, duplicated: 0, examples: [] },
            axe: [], runtime: runtime.slice(errorsBefore).map(({ kind, message }) => ({ kind, message })),
            headings: [], textLength: 0, elapsedMs: Date.now() - started,
            error: error instanceof Error ? error.message : String(error),
            functionalAcceptance: "not-tested",
          });
        }
        await save(false);
      }
    }
    await save(rows.length === expected);
    await info.attach("census.json", { path: join(OUT, "census.json"), contentType: "application/json" });

    const failed = rows.filter((row) => row.disposition === "failed");
    const unsettled = rows.filter((row) => row.disposition === "unsettled");
    const overflow = rows.filter((row) => row.overflow);
    const unnamed = rows.filter((row) => row.names.missing > 0 || row.expandedInventory?.some(control => !control.disclosed && !control.name.trim()));
    const axeBad = rows.filter((row) => row.axe.length > 0);
    const errors = rows.filter((row) => row.runtime.length > 0);
    console.log(JSON.stringify({
      routes: routes.length, expected, rows: rows.length,
      failed: failed.map((row) => `${row.route}@${row.width}: ${row.error ?? row.destination}`),
      unsettled: unsettled.map((row) => `${row.route}@${row.width}`),
      overflow: overflow.map((row) => `${row.route}@${row.width}`),
      unnamed: unnamed.map((row) => `${row.route}@${row.width} (${row.names.missing})`),
      axe: axeBad.map((row) => `${row.route}@${row.width}: ${row.axe.join(", ")}`),
      runtime: errors.map((row) => `${row.route}@${row.width}: ${row.runtime.map((e) => e.message).join(" | ")}`),
      topControls: [...rows].sort((a, b) => b.controls - a.controls).slice(0, 25).map((row) => `${row.route}@${row.width}: ${row.controls}`),
    }, null, 2));

    // Accounting first: a run that dropped rows is not a pass.
    expect(rows.length, "Every selected route/viewport must be accounted for").toBe(expected);
    expect(failed.map((row) => row.route), "No surface may fail to load").toEqual([]);
    expect(unsettled.map((row) => row.route), "No surface may stay perpetually busy").toEqual([]);
    expect(overflow.map((row) => `${row.route}@${row.width}`), "No surface may scroll sideways").toEqual([]);
    expect(unnamed.map((row) => `${row.route}@${row.width}`), "Every control needs an accessible name").toEqual([]);
    if (withAxe) expect(axeBad.map((row) => `${row.route}@${row.width}: ${row.axe.join(", ")}`), "No axe violations").toEqual([]);
    expect(errors.map((row) => `${row.route}@${row.width}: ${row.runtime.map((e) => e.message).join(" | ")}`), "No uncaught errors or 5xx").toEqual([]);
  });

  test("every workspace is reachable from Home by navigation alone", async ({ page, context }, info) => {
    test.setTimeout(30 * 60_000);
    expect(await signInAs(context, "owner"), "A real owner session is mandatory").toBe(true);
    const me = await context.request.get("/api/me");
    const identity = await me.json();
    const org = identity.orgId as string;

    type Reach = { href: string; label: string; clicks: number; path: string[]; found: boolean };
    const reaches: Reach[] = [];

    for (const group of PRODUCT_NAV_GROUPS) {
      const label = group.items[0]!.label;
      const href = group.items[0]!.href;
      const path: string[] = [];
      let clicks = 0;
      let found = false;
      await page.goto(withOrgHref("/dashboard", org), { waitUntil: "domcontentloaded" });
      for (let step = 0; step < 4 && !found; step += 1) {
        // The drawer is the only always-available way into a workspace, so it
        // is opened first — the same thing a person who cannot see the island
        // has to do.
        const menu = page.getByRole("button", { name: /Menu and search/i }).first();
        if (await menu.isVisible().catch(() => false)) {
          await menu.click();
          path.push("menu");
          clicks += 1;
          await page.waitForTimeout(250);
        }
        const row = page.getByRole("link", { name: new RegExp(`^${label}\\b`), exact: false }).first();
        const visible = await row.isVisible().catch(() => false);
        if (!visible) break;
        await row.click();
        clicks += 1;
        path.push(label);
        found = new URL(page.url()).pathname === href;
        if (!found) break;
        await page.waitForLoadState("domcontentloaded").catch(() => {});
      }
      reaches.push({ href, label, clicks, path, found });
    }
    await writeReport("reach.json", { schemaVersion: 1, from: "/dashboard", reaches });
    await info.attach("reach.json", { path: join(OUT, "reach.json"), contentType: "application/json" });
    console.log(JSON.stringify(reaches, null, 2));
    // Home itself is already there, so zero clicks is correct and not an error.
    expect(reaches.filter((reach) => !reach.found).map((reach) => reach.label), "Every workspace must open from Home").toEqual([]);
    expect(Math.max(...reaches.map((reach) => reach.clicks)), "A workspace must be at most 3 clicks from Home").toBeLessThanOrEqual(3);
  });
});
