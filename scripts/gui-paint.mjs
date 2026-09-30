#!/usr/bin/env node
/**
 * Sample what the hub panel actually contains, over time, after a navigation.
 *
 * A screenshot taken when the page happened to be ready cannot tell you that
 * the page was blank for four seconds on the way there. This records the
 * timeline, which is the thing a person standing in the stands actually
 * experiences.
 *
 *   node scripts/gui-paint.mjs /competition
 *   node scripts/gui-paint.mjs --width=390 /competition?tab=scouting
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const route = args.find((a) => !a.startsWith("--")) ?? "/competition";
const width = Number((args.find((a) => a.startsWith("--width=")) ?? "--width=1440").slice(8));
const origin = (process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3419").replace(/\/$/, "");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height: 900 } });
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
await context.addCookies([{ name: "vantage-analytics-consent", value: "denied.1", domain: host, path: "/", sameSite: "Lax" }]);
const me = await (await context.request.get(`${origin}/api/me`)).json();

const page = await context.newPage();
// Warm the route once so the sample measures hydration and data, not a cold
// compile. A person on venue Wi-Fi pays the data cost, not the build cost.
await page.goto(`${origin}${route}${route.includes("?") ? "&" : "?"}orgId=${me.orgId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(6000);

await page.goto("about:blank");
const samples = [];
const started = Date.now();
const target = `${origin}${route}${route.includes("?") ? "&" : "?"}orgId=${me.orgId}`;
page.goto(target, { waitUntil: "commit" }).catch(() => {});
for (let i = 0; i < 60; i += 1) {
  const at = Date.now() - started;
  let snapshot = null;
  try {
    snapshot = await page.evaluate(() => {
      const panel = document.querySelector(".product-hub-panel");
      const main = document.querySelector("main");
      const area = panel ?? main;
      if (!area) return { panel: false, chars: 0, height: 0, controls: 0, text: "" };
      const r = area.getBoundingClientRect();
      return {
        panel: Boolean(panel),
        chars: (area.textContent ?? "").trim().length,
        height: Math.round(r.height),
        controls: area.querySelectorAll("button,a[href],input,select,textarea").length,
        text: (area.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 70),
      };
    }, { timeout: 2000 });
  } catch (error) {
    snapshot = { error: String(error).slice(0, 60) };
  }
  samples.push({ at, ...snapshot });
  await page.waitForTimeout(250);
}

const first = samples.find((s) => s && s.chars > 200);
const firstChrome = samples.find((s) => s && s.chars > 0);
console.log(`${route} @${width}`);
console.log(`  first content:            ${firstChrome ? firstChrome.at + "ms" : "never"}  (${firstChrome?.text ?? ""})`);
console.log(`  first substantial content: ${first ? first.at + "ms" : "never"}  (${first?.text ?? ""})`);
console.log("  timeline:");
let previous = "";
for (const sample of samples) {
  const label = sample.error ? `error ${sample.error}` : `${String(sample.chars).padStart(5)} chars  ${String(sample.controls ?? 0).padStart(3)} ctl  h${String(sample.height ?? 0).padStart(5)}  ${sample.text}`;
  if (label === previous) continue;
  previous = label;
  console.log(`    ${String(sample.at).padStart(6)}ms  ${label}`);
}
await browser.close();
