/**
 * Signed-in route speed against a production server (`next build` + `next start`).
 *
 * The E2E cookie fixture is refused when NODE_ENV=production (proxy.ts). This
 * script signs in as the seeded owner (scripts/seed-e2e-logins.mjs), the same
 * account the browser suite uses, so API routes and the database actually run.
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3011 \
 *   DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:5432/vantage_ci \
 *   node scripts/route-speed.mjs --out /tmp/route-speed-before.json
 *
 * Prints a table and writes JSON. Queries come from pg_stat_statements on the
 * local database only, reset before each sample.
 */
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { chromium } from "playwright";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3011";
const ADMIN = process.env.DATABASE_ADMIN_URL;
const EMAIL = process.env.VANTAGE_E2E_OWNER_EMAIL ?? "e2e-owner@vantage.local";
const PASSWORD = process.env.VANTAGE_E2E_OWNER_PASSWORD ?? "LocalE2EPassword123!";
const SAMPLES = Number(process.env.ROUTE_SPEED_SAMPLES ?? "4");
const outFlag = process.argv.indexOf("--out");
const OUT = outFlag >= 0 ? process.argv[outFlag + 1] : "";

/** Main signed-in routes: the five places, match day, and the tools people open from them. */
const ROUTES = [
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
];

const NAV_ROUTES = ["/competition", "/team", "/build", "/business", "/schedule", "/match-sim", "/ranking-projection", "/scouting"];

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value) {
  return value == null || Number.isNaN(value) ? null : Math.round(value);
}

async function resetStatements(client) {
  await client.query("SELECT pg_stat_statements_reset()");
}

async function readStatements(client) {
  const result = await client.query(`
    SELECT s.calls::int AS calls,
           s.total_exec_time::float8 AS total_ms,
           s.max_exec_time::float8 AS max_ms,
           left(regexp_replace(s.query, '\\s+', ' ', 'g'), 180) AS query
    FROM pg_stat_statements s
    JOIN pg_database d ON d.oid = s.dbid
    WHERE d.datname = current_database()
      AND s.query NOT ILIKE '%pg_stat_statements%'
      AND s.query NOT ILIKE 'SELECT pg_stat_statements_reset%'
  `);
  let queries = 0;
  let slowest = null;
  for (const row of result.rows) {
    queries += Number(row.calls) || 0;
    if (!slowest || Number(row.max_ms) > slowest.maxMs) {
      slowest = { maxMs: Number(row.max_ms), query: row.query };
    }
  }
  return { queries, slowestMs: slowest ? round(slowest.maxMs) : 0, slowestQuery: slowest?.query ?? "" };
}

async function signIn(context) {
  const response = await context.request.post(`${BASE}/api/auth/sign-in/email`, {
    headers: { "content-type": "application/json", origin: BASE },
    data: { email: EMAIL, password: PASSWORD },
    failOnStatusCode: false,
  });
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Sign-in failed HTTP ${response.status()}: ${body.slice(0, 300)}`);
  }
  const host = new URL(BASE).hostname;
  const jar = await context.cookies();
  const session = jar.find((cookie) => cookie.name.includes("session_token") && cookie.domain.replace(/^\./, "") === host);
  if (!session) throw new Error("Sign-in returned no session cookie");
  // next start marks the cookie Secure. Chromium sends it to loopback; keep it.
  return session.name;
}

const CONTENT_PROBE = `(() => {
  const main = document.querySelector("main, #main-content, [role='main']");
  if (!main) return { ready: false, loose: false, skeleton: false, text: 0 };
  const text = (main.innerText || "").replace(/\\s+/g, " ").trim();
  const skeleton = main.getAttribute("aria-busy") === "true"
    || main.classList.contains("route-loading")
    || Boolean(main.querySelector("[aria-busy='true'], .hub-panel-skeleton, .route-loading"));
  // The old probe treated a long skeleton as the page. Strict content is real text
  // with no skeleton still on screen.
  const loose = text.length >= 20 && !(skeleton && text.length < 80);
  const ready = text.length >= 40 && !skeleton;
  return { ready, loose, skeleton, text: text.length };
})()`;

async function proxyRoundTrips(reset) {
  const url = process.env.PG_PROXY_STATS_URL;
  if (!url) return null;
  try {
    const response = await fetch(reset ? `${url}/reset` : url);
    return await response.json();
  } catch {
    return null;
  }
}

async function readJs(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    let decoded = 0;
    let transfer = 0;
    const top = [];
    for (const entry of resources) {
      const name = entry.name || "";
      const script = name.includes(".js") || entry.initiatorType === "script";
      if (!script || entry.initiatorType === "link") continue;
      const size = entry.decodedBodySize || 0;
      const moved = entry.transferSize || entry.encodedBodySize || 0;
      decoded += size;
      transfer += moved;
      top.push({ name: name.split("/").pop(), decoded: size, transfer: moved });
    }
    top.sort((a, b) => b.decoded - a.decoded);
    return {
      ttfb: nav ? nav.responseStart - nav.requestStart : null,
      js: decoded,
      jsTransfer: transfer,
      top: top.slice(0, 6),
    };
  });
}

async function measureDocument(page, db, route) {
  await resetStatements(db);
  await proxyRoundTrips(true);
  const started = Date.now();
  const response = await page.goto(`${BASE}${route}`, { waitUntil: "commit", timeout: 45_000 });
  const status = response?.status() ?? 0;
  const early = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return { ttfb: nav ? nav.responseStart - nav.requestStart : null };
  });
  let contentMs = null;
  let looseMs = null;
  let skeletonMs = null;
  let atContent = null;
  let tripsAtContent = null;
  const deadline = started + 30_000;
  while (Date.now() < deadline) {
    const probe = await page.evaluate(CONTENT_PROBE);
    const elapsed = Date.now() - started;
    if (probe.skeleton && skeletonMs == null) skeletonMs = elapsed;
    if (probe.loose && looseMs == null) looseMs = elapsed;
    if (probe.ready) {
      contentMs = elapsed;
      atContent = await readStatements(db);
      tripsAtContent = await proxyRoundTrips(false);
      break;
    }
    await page.waitForTimeout(40);
  }
  const timing = await readJs(page);
  timing.ttfb = early.ttfb;
  // Later queries include idle prefetch and any long poll still open. The count at
  // content-ready is the page itself.
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
  const sql = await readStatements(db);
  return {
    status,
    ttfbMs: round(timing.ttfb),
    contentMs,
    looseMs,
    skeletonMs,
    jsBytes: timing.js,
    jsTransfer: timing.jsTransfer,
    jsTop: timing.top,
    queriesAtContent: atContent?.queries ?? null,
    roundTrips: tripsAtContent?.total ?? null,
    maxConnectionTrips: tripsAtContent?.maxConnection ?? null,
    ...sql,
  };
}

async function measureClick(page, db, route) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(600);
  const link = page.locator(`a[href="${route}"], a[href^="${route}?"]`).first();
  if ((await link.count()) === 0) return { missingLink: true };
  await resetStatements(db);
  await page.evaluate(() => { globalThis.__navMark = performance.now(); });
  const started = Date.now();
  await link.click();
  let contentMs = null;
  let skeletonMs = null;
  let atContent = null;
  const deadline = started + 12_000;
  while (Date.now() < deadline) {
    const probe = await page.evaluate(CONTENT_PROBE);
    const elapsed = Date.now() - started;
    if (probe.skeleton && skeletonMs == null) skeletonMs = elapsed;
    if (probe.ready && !page.url().includes("/dashboard")) {
      contentMs = elapsed;
      atContent = await readStatements(db);
      break;
    }
    await page.waitForTimeout(30);
  }
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
  const flight = await page.evaluate(() => {
    const clickAt = globalThis.__navMark || 0;
    const entries = performance.getEntriesByType("resource");
    let ttfb = null;
    let js = 0;
    for (const entry of entries) {
      if (entry.startTime < clickAt) continue;
      const name = entry.name || "";
      if (name.includes("_rsc") && ttfb == null) ttfb = entry.responseStart - entry.startTime;
      if (name.includes(".js") || entry.initiatorType === "script") js += entry.transferSize || entry.encodedBodySize || 0;
    }
    return { ttfb, js };
  });
  const sql = await readStatements(db);
  return {
    status: 200,
    ttfbMs: round(flight.ttfb),
    contentMs,
    skeletonMs,
    jsBytes: flight.js,
    url: page.url(),
    queriesAtContent: atContent?.queries ?? null,
    ...sql,
  };
}

function summarize(samples) {
  const pick = (key) => samples.map((row) => row[key]).filter((value) => typeof value === "number");
  const slowest = [...samples].sort((a, b) => (b.slowestMs ?? 0) - (a.slowestMs ?? 0))[0];
  return {
    n: samples.length,
    ttfbP50: round(percentile(pick("ttfbMs"), 50)),
    ttfbP95: round(percentile(pick("ttfbMs"), 95)),
    contentP50: round(percentile(pick("contentMs"), 50)),
    contentP95: round(percentile(pick("contentMs"), 95)),
    looseP50: round(percentile(pick("looseMs"), 50)),
    skeletonP50: round(percentile(pick("skeletonMs"), 50)),
    roundTripsP50: round(percentile(pick("roundTrips"), 50)),
    maxConnectionTripsP50: round(percentile(pick("maxConnectionTrips"), 50)),
    jsBytesP50: round(percentile(pick("jsBytes"), 50)),
    queriesAtContentP50: round(percentile(pick("queriesAtContent"), 50)),
    queriesP50: round(percentile(pick("queries"), 50)),
    slowestMs: slowest?.slowestMs ?? null,
    slowestQuery: slowest?.slowestQuery ?? "",
    statuses: [...new Set(samples.map((row) => row.status))],
  };
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  console.log("route | ttfb p50 | ttfb p95 | content p50 | content p95 | loose p50 | skeleton p50 | js decoded | round trips | max conn trips | queries at content | queries after | slowest ms");
  for (const row of rows) {
    const s = row.summary;
    console.log(
      [
        row.route,
        s.ttfbP50,
        s.ttfbP95,
        s.contentP50,
        s.contentP95,
        s.looseP50,
        s.skeletonP50,
        s.jsBytesP50,
        s.roundTripsP50,
        s.maxConnectionTripsP50,
        s.queriesAtContentP50,
        s.queriesP50,
        s.slowestMs,
      ].join(" | "),
    );
  }
}

async function main() {
  if (!ADMIN) throw new Error("Set DATABASE_ADMIN_URL to the local test database");
  const host = new URL(ADMIN.replace(/^postgres(ql)?:/, "http:")).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("Refusing a non-local database");
  const db = new pg.Client({ connectionString: ADMIN });
  await db.connect();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.setItem("vantage.tour.v1", "done"); } catch { /* optional */ }
  });
  await signIn(context);
  const page = await context.newPage();
  // One throwaway hit so the first measured route is not the process's only cold start.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(500);

  const documents = [];
  for (const route of ROUTES) {
    const samples = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      try {
        samples.push(await measureDocument(page, db, route));
      } catch (error) {
        samples.push({ status: 0, ttfbMs: null, contentMs: null, skeletonMs: null, jsBytes: 0, queries: 0, slowestMs: null, slowestQuery: "", error: String(error).slice(0, 200) });
      }
    }
    const summary = summarize(samples.filter((row) => !row.error));
    documents.push({ route, summary, samples });
    console.log(`doc ${route} ttfb p50 ${summary.ttfbP50} content p50 ${summary.contentP50} queries ${summary.queriesP50}`);
  }

  const clicks = [];
  if (process.env.ROUTE_SPEED_SKIP_NAV === "1") {
    console.log("skipping client-nav samples");
  }
  for (const route of process.env.ROUTE_SPEED_SKIP_NAV === "1" ? [] : NAV_ROUTES) {
    const samples = [];
    for (let i = 0; i < Math.min(SAMPLES, 3); i += 1) {
      try {
        samples.push(await measureClick(page, db, route));
      } catch (error) {
        samples.push({ status: 0, error: String(error).slice(0, 200) });
      }
    }
    clicks.push({ route, summary: summarize(samples.filter((row) => !row.error && !row.missingLink)), samples });
    console.log(`nav ${route} content p50 ${clicks.at(-1).summary.contentP50}`);
  }

  const report = {
    base: BASE,
    samples: SAMPLES,
    measuredAt: new Date().toISOString(),
    documents,
    clicks,
  };
  printTable("DOCUMENT LOADS", documents);
  printTable("CLIENT NAV FROM HOME", clicks);
  if (OUT) await writeFile(OUT, JSON.stringify(report, null, 2));
  await browser.close();
  await db.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
