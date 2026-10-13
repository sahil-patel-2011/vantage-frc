#!/usr/bin/env node
/**
 * Look at Vantage the way a person does: sign in, open pages at phone and desktop size, save a
 * screenshot of each, and report what a reviewer would catch by eye. For agents verifying a change
 * against a local dev server (never production: the sign-in uses dev-only codes).
 *
 *   node scripts/agent/ui-check.mjs --email owner@example.test --out /tmp/shots \
 *     --view phone,desktop /dashboard "/build?tab=code" /settings
 *
 * Options
 *   --base     dev server origin (default http://localhost:3001)
 *   --email    account to sign in as; omit for signed-out pages
 *   --out      folder for screenshots and the saved session (default ./ui-check-out)
 *   --view     phone, desktop or both (default both)
 *   --wait     ms to wait after each page loads (default 5000)
 *   --dark     also capture in dark mode
 *
 * For every page it prints: the final URL (so redirects show), console errors, failed or 5xx
 * responses, text under 11px, tap targets under 40px on phone, sideways scrolling, and words set
 * in the monospace face. The screenshots are the real check: open and read them.
 */
/* global document, window, getComputedStyle -- the scan below runs inside the page. */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};

const BASE = opt("base", "http://localhost:3001").replace(/\/$/, "");
const EMAIL = opt("email", "");
const OUT = path.resolve(opt("out", "ui-check-out"));
const VIEWS = opt("view", "phone,desktop").split(",");
const WAIT = Number(opt("wait", "5000"));
const DARK = flag("dark");
const PATHS = args.length ? args : ["/"];

if (/vercel\.app|vantagefrc/i.test(BASE)) {
  console.error("ui-check signs in with dev-only codes; point it at a local dev server, not production.");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 860 } },
};

/** The cloud containers ship Chromium under /opt/pw-browsers; elsewhere Playwright finds its own. */
function chromiumPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = path.join(root, dir, "chrome-linux", "chrome");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

function devOtp(email) {
  return execFileSync("node", ["scripts/dev-otp.mjs", email, "sign-in"], { encoding: "utf8" }).trim();
}

async function signIn(context, email) {
  const page = await context.newPage();
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const box = page.locator("input[type=email]").first();
  if (!(await box.count())) {
    const toEmail = page.getByRole("button", { name: /email/i }).first();
    if (await toEmail.count()) await toEmail.click();
  }
  await page.locator("input[type=email]").first().fill(email);
  await page.locator("input[type=email]").first().press("Enter");
  await page.waitForTimeout(2000);
  await page.keyboard.type(devOtp(email), { delay: 30 });
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 30000 }).catch(() => {});
  await page.close();
}

/** What a careful reviewer would flag on sight. */
async function scan(page, phone) {
  return page.evaluate((isPhone) => {
    const issues = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) issues.push(`scrolls sideways: ${doc.scrollWidth}px wide in a ${window.innerWidth}px window`);
    const small = new Map();
    const mono = new Map();
    for (const el of document.querySelectorAll("body *")) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
      if (!own) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const style = getComputedStyle(el);
      const key = `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")}`;
      if (parseFloat(style.fontSize) < 11 && !small.has(key)) small.set(key, `${style.fontSize} "${own.slice(0, 30)}"`);
      if (/mono|plex/i.test(style.fontFamily) && /[a-z]{3,}/i.test(own) && !el.closest("code,pre,kbd,samp,textarea,input") && !mono.has(key)) {
        mono.set(key, `"${own.slice(0, 30)}"`);
      }
    }
    for (const [key, what] of small) issues.push(`text under 11px: ${key} ${what}`);
    for (const [key, what] of mono) issues.push(`words in monospace: ${key} ${what}`);
    if (isPhone) {
      for (const el of document.querySelectorAll("a, button, [role=button], [role=tab], input, select, summary")) {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height || box.height >= 40 || el.closest("p, li > p")) continue;
        // A checkbox or radio is pressed through its label; the skip link only shows on focus.
        const label = el.closest("label");
        if (label && label.getBoundingClientRect().height >= 40) continue;
        if (el.matches(".soft-skip-link, [href='#main-content']")) continue;
        issues.push(`small tap target (${Math.round(box.width)}×${Math.round(box.height)}): ${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)}`);
        if (issues.length > 40) break;
      }
    }
    return issues.slice(0, 40);
  }, phone);
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
let failed = 0;
for (const view of VIEWS) {
  const statePath = path.join(OUT, `session-${EMAIL || "signed-out"}-${view}.json`);
  const context = await browser.newContext({
    ...VIEWPORTS[view],
    ...(EMAIL && existsSync(statePath) ? { storageState: statePath } : {}),
  });
  if (EMAIL && !existsSync(statePath)) {
    await signIn(context, EMAIL);
    await context.storageState({ path: statePath });
  }
  for (const route of PATHS) {
    for (const scheme of DARK ? ["light", "dark"] : ["light"]) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: scheme });
      const problems = [];
      page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 160)}`); });
      page.on("pageerror", (e) => problems.push(`page error: ${String(e).slice(0, 160)}`));
      page.on("response", (r) => { if (r.status() >= 500) problems.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(WAIT);
      const file = path.join(OUT, `${view}-${scheme}-${route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const issues = [...problems, ...(await scan(page, view === "phone"))];
      if (problems.length) failed += 1;
      console.log(`\n${view} ${scheme} ${route} → ${page.url().replace(BASE, "")}\n  screenshot: ${file}`);
      for (const issue of issues) console.log(`  - ${issue}`);
      await page.close();
    }
  }
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
