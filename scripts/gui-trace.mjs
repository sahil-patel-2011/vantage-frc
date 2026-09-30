#!/usr/bin/env node
/**
 * Run one in-page expression against a signed-in route and print the result.
 * For tracing a specific finding — "which three elements point at Home, and
 * are any of them in the tab order?" — without re-deriving a session each time.
 *
 *   node scripts/gui-trace.mjs /competition "() => [...document.querySelectorAll('a[href*=dashboard]')].map(a => a.closest('[class]').className)"
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const route = args[0] ?? "/competition";
const expression = args[1] ?? "() => document.title";
if (!args[1]) {
  console.error("usage: node scripts/gui-trace.mjs <route> <expression>");
  process.exit(1);
}
const origin = (process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3419").replace(/\/$/, "");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const signIn = await context.request.post(`${origin}/api/auth/sign-in/email`, {
  headers: { "content-type": "application/json", origin },
  data: {
    email: process.env.VANTAGE_E2E_OWNER_EMAIL ?? "e2e-owner@vantage.local",
    password: process.env.VANTAGE_E2E_OWNER_PASSWORD ?? "LocalE2EPassword123!",
  },
});
if (!signIn.ok()) { console.error(`sign-in failed ${signIn.status()}`); process.exit(1); }
const host = new URL(origin).hostname;
const jar = await context.cookies();
const session = jar.find((c) => c.name.includes("session_token") && (c.domain === host || c.domain === `.${host}`));
await context.addCookies([{ name: session.name, value: session.value, url: origin }]);
const me = await (await context.request.get(`${origin}/api/me`)).json();

const page = await context.newPage();
await page.goto(`${origin}${route}${route.includes("?") ? "&" : "?"}orgId=${me.orgId}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const panel = document.querySelector(".product-hub-panel");
  return !panel || (panel.textContent?.trim().length ?? 0) > 30;
}, undefined, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1200);

try {
  // Playwright treats a string as an expression, so `() => …` would come back
  // as a function object rather than its result. Call it when it is one.
  const isFunction = /^\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(expression);
  const result = await page.evaluate(isFunction ? `(${expression})()` : expression);
  console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
} catch (error) {
  console.error("evaluate failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
await browser.close();
