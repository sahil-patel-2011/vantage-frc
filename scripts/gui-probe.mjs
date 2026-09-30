#!/usr/bin/env node
/**
 * Probe specific elements on a route and print their resolved colour, the
 * background chain behind them, and the resulting contrast ratio. Used to check
 * a contrast finding before changing a token, because a ratio computed from a
 * guessed background is worse than no ratio at all.
 *
 *   node scripts/gui-probe.mjs /build ".app-badge.good" ".soft-topbar-product-suffix"
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const route = args[0] ?? "/competition";
const selectors = args.slice(1);
if (!selectors.length) {
  console.error("usage: node scripts/gui-probe.mjs <route> <selector>…");
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
await page.waitForTimeout(900);

const out = await page.evaluate((sels) => {
  const rgb = (value) => {
    const m = String(value).match(/-?[\d.]+/g);
    return m ? m.map(Number) : null;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const chain = (el) => {
    const rows = [];
    let node = el;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      rows.push({
        node: node.tagName.toLowerCase() + (typeof node.className === "string" && node.className ? "." + node.className.trim().split(/\s+/).join(".") : ""),
        color: s.color,
        background: s.backgroundColor,
        image: s.backgroundImage === "none" ? "" : s.backgroundImage.slice(0, 60),
        opacity: s.opacity,
      });
      node = node.parentElement;
    }
    rows.push({ node: "html", color: getComputedStyle(document.documentElement).color, background: getComputedStyle(document.documentElement).backgroundColor, image: "", opacity: "1" });
    return rows;
  };
  // Paint the real backdrop: ask the engine what is behind a point is not possible,
  // so composite every ancestor layer that is opaque enough, which is what the
  // eye does when nothing is translucent on top of it.
  const composite = (rows) => {
    let base = [255, 255, 255, 1];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const c = rgb(rows[i].background);
      const a = c ? (c.length > 3 ? c[3] : 1) : 0;
      if (c && a > 0) {
        base = [0, 1, 2].map((k) => c[k] * a + base[k] * (1 - a)).concat(1);
        if (a >= 0.95) break;
      }
    }
    return base;
  };
  return sels.map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, missing: true };
    const rows = chain(el);
    const bg = composite(rows);
    const s = getComputedStyle(el);
    const fg = rgb(s.color);
    const fgA = fg && fg.length > 3 ? fg[3] : 1;
    const eff = fgA < 1 ? [0, 1, 2].map((k) => fg[k] * fgA + bg[k] * (1 - fgA)).concat(1) : fg;
    const l1 = lum(eff.slice(0, 3));
    const l2 = lum(bg.slice(0, 3));
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    return {
      sel,
      text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
      color: s.color,
      fontSize: size,
      fontWeight: s.fontWeight,
      backdrop: `rgb(${bg.slice(0, 3).map(Math.round).join(", ")})`,
      ratio: Math.round(ratio * 100) / 100,
      need,
      pass: ratio >= need,
      chain: rows.slice(0, 5),
    };
  });
}, selectors);

for (const row of out) {
  if (row.missing) { console.log(`✗ ${row.sel} — not found`); continue; }
  console.log(`${row.pass ? "✓" : "✗"} ${row.sel}  "${row.text}"  ${row.ratio}:1 (needs ${row.need})  ${row.fontSize}px/${row.fontWeight}  fg=${row.color} bg=${row.backdrop}`);
  for (const link of row.chain) console.log(`      ${link.node}  bg=${link.background}  img=${link.image}  color=${link.color}  op=${link.opacity}`);
}
await browser.close();
