#!/usr/bin/env node
/**
 * Walk the Vantage GUI in a real signed-in session and save a screenshot plus a
 * control census for every surface you name.
 *
 *   node scripts/gui-walk.mjs /competition /team /build            # 1440
 *   node scripts/gui-walk.mjs --width=390 --tag=phone /competition
 *   node scripts/gui-walk.mjs --width=1440 --full /build
 *
 * The dev server must already be running; it is the one a person is looking at.
 * Nothing here mutates data — it opens surfaces, counts what is on them, and
 * writes PNGs to audit-artifacts/walk/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { ANALYTICS_CONSENT_COOKIE, serializeConsent } from "../apps/web/lib/product-analytics/consent.ts";
import { COLOR_SOURCE } from "./lib/gui-color.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);
const routes = args.filter((a) => !a.startsWith("--"));
if (!routes.length) {
  console.error("usage: node scripts/gui-walk.mjs [--width=1440] [--full] [--tag=name] <route>…");
  process.exit(1);
}

const origin = (process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3419").replace(/\/$/, "");
const width = Number(flag("width", "1440"));
const height = Number(flag("height", "900"));
const tag = flag("tag", `${width}`);
const outDir = resolve(process.env.GUI_WALK_OUT ?? "audit-artifacts/walk", tag);
mkdirSync(outDir, { recursive: true });

const account = {
  email: process.env.VANTAGE_E2E_OWNER_EMAIL ?? "e2e-owner@vantage.local",
  password: process.env.VANTAGE_E2E_OWNER_PASSWORD ?? "LocalE2EPassword123!",
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: has("dark") ? "dark" : "light" });
await context.addInitScript(() => {
  try { localStorage.setItem("vantage.tour.v1", "done"); } catch { /* storage blocked: the tour just shows */ }
});
// Answer the first-run questions so a census measures the product a returning
// member sees, not the two overlays a brand-new account gets. Pass
// --firstrun to measure those instead.
if (!has("firstrun")) {
  const hostname = new URL(origin).hostname;
  await context.addCookies([{
    name: ANALYTICS_CONSENT_COOKIE,
    value: serializeConsent("denied"),
    domain: hostname,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
}

const signIn = await context.request.post(`${origin}/api/auth/sign-in/email`, {
  headers: { "content-type": "application/json", origin },
  data: account,
});
if (!signIn.ok()) {
  console.error(`sign-in failed: HTTP ${signIn.status()}`);
  process.exit(1);
}
const host = new URL(origin).hostname;
const jar = await context.cookies();
const session = jar.find((c) => c.name.includes("session_token") && (c.domain === host || c.domain === `.${host}`));
if (!session) { console.error("no session cookie"); process.exit(1); }
await context.addCookies([{ name: session.name, value: session.value, url: origin }]);

const me = await context.request.get(`${origin}/api/me`);
const identity = await me.json();
if (!identity.authenticated) { console.error("session did not authenticate"); process.exit(1); }
const org = identity.orgId;

/**
 * In-page measurement. Everything reads the rendered result — computed styles,
 * resolved colours, box geometry, the accessibility tree — rather than the
 * source, because the question is what a person is actually looking at.
 */
const MEASURE = `(() => {
  ${COLOR_SOURCE}
  // The backdrop behind an element: every ancestor layer, bottom-most opaque
  // layer first, each translucent one composited over what is under it. A
  // gradient counts as unknown, so the walk stops there and the text is
  // reported as "unresolved" rather than guessed at.
  const backdropOf = (el) => {
    const layers = [];
    let node = el;
    let gradient = false;
    while (node) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") { gradient = true; break; }
      const colour = parseColor(style.backgroundColor);
      if (colour && (colour[3] ?? 1) > 0) {
        layers.push(colour);
        if ((colour[3] ?? 1) >= 0.95) break;
      }
      node = node.parentElement;
    }
    if (!layers.length) return { colour: [255, 255, 255, 1], gradient };
    let result = layers[layers.length - 1];
    for (let i = layers.length - 2; i >= 0; i -= 1) result = over(layers[i], result);
    return { colour: result, gradient };
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    const opacity = parseFloat(s.opacity);
    if (Number.isFinite(opacity) && opacity < 0.15) return false;
    if (el.closest("[inert]") || el.closest("[aria-hidden='true']")) return false;
    const closed = el.closest("details:not([open])");
    if (closed && !closed.querySelector(":scope > summary")?.contains(el)) return false;
    return true;
  };
  const accName = (el) => {
    const a = el.getAttribute("aria-label")?.trim();
    if (a) return a;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
      if (t) return t;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      if (el.labels?.length) return el.labels[0]?.textContent?.trim() ?? "";
      if (el.id) {
        const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lab) return lab.textContent?.trim() ?? "";
      }
      return el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "";
    }
    if (el.tagName === "IMG") return el.getAttribute("alt") ?? "";
    return (el.textContent ?? "").trim().replace(/\\s+/g, " ");
  };

  const SELECTOR = "button,a[href],input,select,textarea,summary,[role='button'],[role='tab'],[role='switch'],[role='menuitem']";
  const all = [...document.querySelectorAll(SELECTOR)].filter((el) => !el.closest("nextjs-portal"));
  const live = all.filter(visible);

  // --- control census -------------------------------------------------
  const controls = live.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      name: accName(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
      small: Math.max(r.width, 0) < 44 || r.height < 32,
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      region: (el.closest("header,nav,main,aside,footer,form,details,dialog")?.tagName ?? "").toLowerCase(),
    };
  });

  // --- repeated names, on the same screen ---------------------------
  const nameTally = new Map();
  for (const el of live) {
    const key = accName(el).toLocaleLowerCase().replace(/\\s+/g, " ").trim();
    if (!key) continue;
    const entry = nameTally.get(key) ?? { count: 0, tags: [] };
    entry.count += 1;
    entry.tags.push(el.tagName.toLowerCase());
    nameTally.set(key, entry);
  }
  const duplicates = [...nameTally.entries()].filter(([, v]) => v.count > 1).map(([k, v]) => ({ name: k, count: v.count }));

  // --- repeated destinations ---------------------------------------
  // The honest measure of "too many buttons to find what you want": not how
  // many controls there are, but how many of them open somewhere you have
  // already been. Two buttons for one page is one too many, whatever they are
  // called, and it is what a person actually has to read past.
  const hrefTally = new Map();
  for (const el of live) {
    const href = el.getAttribute?.("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    let key;
    try { key = new URL(href, location.href).pathname + new URL(href, location.href).search; } catch { key = href; }
    if (key === location.pathname + location.search) continue;
    const entry = hrefTally.get(key) ?? { count: 0, labels: new Set() };
    entry.count += 1;
    const label = el.getAttribute("aria-label") ?? (accName(el) || (el.textContent ?? ""));
    entry.labels.add(label.trim().replace(/\\s+/g, " ").slice(0, 34));
    hrefTally.set(key, entry);
  }
  const duplicateDestinations = [...hrefTally.entries()]
    .filter(([, v]) => v.count > 1)
    .map(([href, v]) => ({ href, count: v.count, labels: [...v.labels] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  const redundantControls = duplicateDestinations.reduce((sum, d) => sum + (d.count - 1), 0);

  // --- contrast on text ---------------------------------------------
  const textNodes = [...document.querySelectorAll("p,span,a,li,h1,h2,h3,h4,label,td,th,dt,dd,small,strong,em,button,summary,legend,figcaption,time")]
    .filter((el) => visible(el) && !el.querySelector("p,span,a,li,h1,h2,h3,h4,label,td,th,dt,dd,small,strong,em,button,summary"))
    .filter((el) => (el.textContent ?? "").trim().length > 0);
  const lowContrast = [];
  const seenPairs = new Set();
  for (const el of textNodes.slice(0, 900)) {
    const style = getComputedStyle(el);
    const fg = parseColor(style.color);
    if (!fg) continue;
    const backdrop = backdropOf(el);
    if (backdrop.gradient) continue;
    const effective = over(fg, backdrop.colour);
    const ratio = contrast(effective, backdrop.colour);
    if (ratio === null) continue;
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      const key = style.color + "|" + size + "|" + Math.round(ratio * 10);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      lowContrast.push({
        text: (el.textContent ?? "").trim().replace(/\\s+/g, " ").slice(0, 44),
        ratio: Math.round(ratio * 100) / 100,
        need,
        size: Math.round(size),
        color: style.color,
        cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 50),
      });
    }
  }

  // --- headings -------------------------------------------------------
  const headings = [...document.querySelectorAll("main h1,main h2,main h3,main h4,main h5,main h6")].filter(visible);
  const levels = headings.map((h) => Number(h.tagName[1]));
  let headingJumps = 0;
  for (let i = 1; i < levels.length; i += 1) if (levels[i] - levels[i - 1] > 1) headingJumps += 1;
  const h1s = headings.filter((h) => h.tagName === "H1").length;

  // --- tap targets ----------------------------------------------------
  const tooSmall = live.filter((c) => {
    const r = c.getBoundingClientRect();
    return !c.closest("p,li,td,th") && (r.width < 24 || r.height < 24);
  }).map((c) => ({ name: (accName(c) || c.tagName).slice(0, 40), tag: c.tagName.toLowerCase() }));

  // --- fixed chrome covering content ---------------------------------
  const floating = [...document.querySelectorAll("body *")]
    .filter((el) => {
      const s = getComputedStyle(el);
      return (s.position === "fixed" || s.position === "sticky") && visible(el);
    })
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter((f) => f.r.width > 80 && f.r.height > 30 && f.r.height < innerHeight * 0.6);
  const occluded = [];
  for (const f of floating) {
    for (const el of document.querySelectorAll("main a, main button, main li, main article, main h1, main h2, main h3, main p, main strong, main section")) {
      if (f.el.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const ox = Math.min(r.right, f.r.right) - Math.max(r.left, f.r.left);
      const oy = Math.min(r.bottom, f.r.bottom) - Math.max(r.top, f.r.top);
      if (ox > 8 && oy > 8) occluded.push({ by: f.el.className || f.el.tagName, text: (el.textContent ?? "").trim().replace(/\\s+/g, " ").slice(0, 34) });
    }
  }

  // --- raw colour discipline ------------------------------------------
  let rawColors = 0;
  const sheets = [...document.styleSheets];
  for (const sheet of sheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (!rule.selectorText || !rule.style) continue;
      if (!/#[0-9a-f]{3,8}\\b|rgba?\\(/.test(rule.cssText)) continue;
      if (/--[a-z0-9-]+\\s*:/.test(rule.selectorText)) continue;
      rawColors += (rule.cssText.match(/#[0-9a-f]{3,8}\\b|rgba?\\(/g) ?? []).length;
    }
  }

  const main = document.querySelector("main");
  const text = (main ?? document.body).innerText;
  return {
    controls: controls.length,
    buttons: controls.filter((c) => c.tag === "button" || c.tag === "summary" || c.tag === "a").length,
    duplicateDestinations,
    redundantControls,
    inViewport: controls.filter((c) => {
      const el = live[controls.indexOf(c)];
      const r = el.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    }).length,
    unnamed: live.filter((c) => !accName(c).trim()).map((c) => c.tagName.toLowerCase()),
    duplicates,
    lowContrast: lowContrast.slice(0, 12),
    smallTargets: tooSmall.slice(0, 12),
    occluded: occluded.slice(0, 10),
    occludedCount: occluded.length,
    headings: headings.map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? "").trim().slice(0, 50) })),
    h1s,
    headingJumps,
    rawColors,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    railVisible: (() => { const r = document.querySelector(".app-sidebar, .vrail"); return r ? getComputedStyle(r).display !== "none" : false; })(),
    islandVisible: (() => { const r = document.querySelector(".soft-island"); if (!r) return false; const b = r.getBoundingClientRect(); return b.width > 0; })(),
    topbarDeadSpace: (() => {
      const bar = document.querySelector(".soft-topbar");
      if (!bar) return null;
      const lead = bar.querySelector(".soft-topbar-lead");
      const actions = bar.querySelector(".soft-topbar-actions");
      if (!lead || !actions) return null;
      const gap = actions.getBoundingClientRect().left - lead.getBoundingClientRect().right;
      return Math.round(gap);
    })(),
    textLength: text.length,
    loadingWords: /^(Loading|Opening|Fetching|Retrieving|Working)\b/i.test(text.trim()) ? text.trim().slice(0, 60) : null,
    pageHeight: document.documentElement.scrollHeight,
    controls_detail: controls,
  };
})()`;

const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("response", (r) => {
  if (r.status() >= 500 && r.url().startsWith(origin)) problems.push(`http ${r.status()} ${new URL(r.url()).pathname}`);
});

const slug = (route) => route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "root";
const results = [];

for (const route of routes) {
  const target = route.includes("?") ? `${route}&orgId=${org}` : `${route}?orgId=${org}`;
  const started = Date.now();
  let errors = [];
  const onErr = (e) => errors.push(String(e.message ?? e));
  page.on("pageerror", onErr);
  try {
    await page.goto(`${origin}${target}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    // Settle on content, not on a clock: the hub panel must have real text in it.
    await page.waitForFunction(() => {
      const panel = document.querySelector(".product-hub-panel");
      return !panel || (panel.textContent?.trim().length ?? 0) > 30;
    }, undefined, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
    const census = await page.evaluate(MEASURE);
    const file = join(outDir, `${slug(route)}.png`);
    await page.screenshot({ path: file, fullPage: has("full"), timeout: 30_000 });
    const { controls_detail, ...summary } = census;
    results.push({ route, ok: true, ms: Date.now() - started, file, ...summary, controls_detail, errors: [...errors, ...problems.splice(0)] });
    const flags = [
      census.overflow ? "OVERFLOW" : "",
      census.unnamed.length ? `UNNAMED:${census.unnamed.length}` : "",
      census.duplicates.length ? `DUPNAME:${census.duplicates.length}` : "",
      census.redundantControls ? `REDDUNDANT:${census.redundantControls}` : "",
      census.lowContrast.length ? `CONTRAST:${census.lowContrast.length}` : "",
      census.occludedCount ? `OCCLUDED:${census.occludedCount}` : "",
      census.headingJumps ? `HJUMP:${census.headingJumps}` : "",
      census.loadingWords ? "STILL-LOADING" : "",
    ].filter(Boolean);
    console.log(`✓ ${route.padEnd(40)} ${String(census.controls).padStart(3)}ctrl ${String(census.buttons).padStart(3)}btn h1:${census.h1s} ${census.railVisible ? "rail" : "no-rail"} ${census.islandVisible ? "island" : "no-island"} ${flags.join(" ")}`);
  } catch (error) {
    console.log(`✗ ${route.padEnd(44)} ${error instanceof Error ? error.message : String(error)}`);
    results.push({ route, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  page.off("pageerror", onErr);
}

writeFileSync(join(outDir, "walk.json"), JSON.stringify({ origin, width, height, org, results }, null, 2));
console.log(`\nWrote ${results.filter((r) => r.ok).length} screenshots and walk.json to ${outDir}`);
await browser.close();
