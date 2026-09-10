/**
 * HTTP walk of every visit-able FEATURE_MAP route.
 *
 * Chromium compiling 143 next-dev pages in one session hung the compiler
 * (API calls sat at 31s, then the process died). Fetching the same catalog
 * with the fixture cookie still proves the pages do not 500.
 *
 *   E2E_AUTH_FIXTURE=1 npm run dev:test --workspace=@vantage/web
 *   FEATURE_MAP_BASE_URL=http://localhost:3001 FEATURE_MAP_COOKIE='better-auth.session_token=…' \
 *     node --experimental-strip-types scripts/feature-map-http-walk.mjs
 */
import { readFileSync } from "node:fs";
import { productRoutesFromFeatureMap } from "../apps/web/lib/nav/feature-map-routes.ts";

const BASE = (process.env.FEATURE_MAP_BASE_URL ?? "http://localhost:3310").replace(/\/$/, "");
const usingSessionCookie = Boolean(process.env.FEATURE_MAP_COOKIE);
const COOKIE = process.env.FEATURE_MAP_COOKIE ?? "vantage-e2e-session=authenticated";
const markdown = readFileSync(new URL("../docs/FEATURE_MAP.md", import.meta.url), "utf8");
const routes = productRoutesFromFeatureMap(markdown);

const failures = [];
const notFound = [];
const summary = { ok: 0, redirect: 0, notFound: 0, failed: 0 };

for (const route of routes) {
  const url = `${BASE}${route}`;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { cookie: COOKIE },
      signal: AbortSignal.timeout(30_000),
    });
    const status = response.status;
    if (status >= 500) {
      failures.push(`${route} HTTP ${status}`);
      summary.failed += 1;
      continue;
    }
    if (status === 404) {
      notFound.push(`${route} → ${response.url}`);
      summary.notFound += 1;
      continue;
    }
    if (status >= 300 && status < 400) summary.redirect += 1;
    else summary.ok += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${route} ${message}`);
    summary.failed += 1;
  }
}

console.log(
  JSON.stringify(
    {
      base: BASE,
      auth: usingSessionCookie ? "FEATURE_MAP_COOKIE" : "fixture",
      routes: routes.length,
      ...summary,
      notFound,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length) process.exit(1);
