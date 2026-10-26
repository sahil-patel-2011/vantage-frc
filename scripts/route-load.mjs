/**
 * Concurrent full-content load against a local production server.
 *
 * The database sits behind scripts/pg-latency-proxy.mjs. Set that proxy to 40ms
 * before running. Each sample is a real browser navigation, and "content" is the
 * same strict probe as scripts/route-speed.mjs: main text is on screen and no
 * skeleton is still marked busy.
 *
 *   PG_PROXY_STATS_URL=http://127.0.0.1:5434 \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3011 \
 *   node scripts/route-load.mjs --out /tmp/route-load.json
 *
 * One signed-in session is reused across the concurrent tabs. That is one person
 * opened many times, not 100 separate accounts. Page queries still run per tab.
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3011";
const EMAIL = process.env.VANTAGE_E2E_OWNER_EMAIL ?? "e2e-owner@vantage.local";
const PASSWORD = process.env.VANTAGE_E2E_OWNER_PASSWORD ?? "LocalE2EPassword123!";
const LEVELS = (process.env.ROUTE_LOAD_LEVELS ?? "25,100").split(",").map((value) => Number(value.trim())).filter((value) => value > 0);
const outFlag = process.argv.indexOf("--out");
const OUT = outFlag >= 0 ? process.argv[outFlag + 1] : "";

const ROUTES = (process.env.ROUTE_LOAD_ROUTES ?? [
  "/dashboard",
  "/competition",
  "/scouting",
  "/strategy",
  "/schedule",
  "/my-day",
  "/command",
  "/match-sim",
  "/ranking-projection",
  "/intel",
  "/team",
  "/messages",
  "/calendar",
  "/todos",
  "/files",
  "/business",
  "/build",
  "/ai",
  "/settings",
  "/account",
  "/notifications",
  "/hours",
  "/pit",
  "/scout",
  "/workspace",
].join(",")).split(",").map((route) => route.trim()).filter(Boolean);

const CONTENT_PROBE = `(() => {
  const main = document.querySelector("main, #main-content, [role='main']");
  if (!main) return { ready: false, skeleton: false, text: 0 };
  const text = (main.innerText || "").replace(/\\s+/g, " ").trim();
  const skeleton = main.getAttribute("aria-busy") === "true"
    || main.classList.contains("route-loading")
    || Boolean(main.querySelector("[aria-busy='true'], .hub-panel-skeleton, .route-loading"));
  return { ready: text.length >= 40 && !skeleton, skeleton, text: text.length };
})()`;

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function signIn(context) {
  const response = await context.request.post(`${BASE}/api/auth/sign-in/email`, {
    headers: { "content-type": "application/json", origin: BASE },
    data: { email: EMAIL, password: PASSWORD },
    failOnStatusCode: false,
  });
  if (!response.ok()) throw new Error(`Sign-in failed HTTP ${response.status()}`);
  const host = new URL(BASE).hostname;
  const jar = await context.cookies();
  const session = jar.find((cookie) => cookie.name.includes("session_token") && cookie.domain.replace(/^\./, "") === host);
  if (!session) throw new Error("Sign-in returned no session cookie");
  return session;
}

async function waitForContent(page, started) {
  const deadline = started + 20_000;
  while (Date.now() < deadline) {
    const probe = await page.evaluate(CONTENT_PROBE).catch(() => ({ ready: false }));
    if (probe.ready) return Date.now() - started;
    await page.waitForTimeout(80);
  }
  return null;
}

async function hitRoute(pages, route, concurrency) {
  const started = Date.now();
  const times = await Promise.all(pages.map(async (page) => {
    const began = Date.now();
    try {
      const response = await page.goto(`${BASE}${route}`, { waitUntil: "commit", timeout: 45_000 });
      const status = response?.status() ?? 0;
      const contentMs = await waitForContent(page, began);
      return { status, contentMs };
    } catch (error) {
      return { status: 0, contentMs: null, error: String(error).slice(0, 180) };
    }
  }));
  const ok = times.map((row) => row.contentMs).filter((value) => typeof value === "number");
  const missed = times.length - ok.length;
  const errors = times.map((row) => row.error).filter(Boolean).slice(0, 3);
  return {
    route,
    concurrency,
    wallMs: Date.now() - started,
    n: times.length,
    ready: ok.length,
    missed,
    errors,
    contentP50: ok.length ? Math.round(percentile(ok, 50)) : null,
    contentP95: ok.length ? Math.round(percentile(ok, 95)) : null,
    pass: ok.length > 0 && percentile(ok, 95) < 1000 && missed === 0,
  };
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const signContext = await browser.newContext();
  const session = await signIn(signContext);
  await signContext.close();
  const levels = [];
  for (const concurrency of LEVELS) {
    const context = await browser.newContext();
    if (process.env.ROUTE_LOAD_BLOCK_ASSETS === "1") {
      await context.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (type === "image" || type === "media" || type === "font") return route.abort();
        return route.continue();
      });
    }
    await context.addCookies([session]);
    await context.addInitScript(() => {
      try { localStorage.setItem("vantage.tour.v1", "done"); } catch { /* optional */ }
    });
    const pages = [];
    for (let i = 0; i < concurrency; i += 1) pages.push(await context.newPage());
    // One navigation fills the in-process onboarding cache. The burst below is the load.
    await pages[0].goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    const routes = [];
    for (const route of ROUTES) {
      const row = await hitRoute(pages, route, concurrency);
      routes.push(row);
      const mark = row.pass ? "pass" : "miss";
      console.log(`${concurrency} ${route} p50 ${row.contentP50} p95 ${row.contentP95} ready ${row.ready}/${row.n} ${mark}`);
    }
    levels.push({ concurrency, routes });
    await context.close();
  }
  const report = {
    base: BASE,
    delayMs: 40,
    session: "one signed-in owner, many tabs",
    measuredAt: new Date().toISOString(),
    levels,
  };
  if (OUT) await writeFile(OUT, JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
