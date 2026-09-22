import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A panel that floats over the page can be dismissed by clicking away from it.
 *
 * The distinction this test is careful about: a *floating* panel covers content
 * and should close on an outside click, the way every menu on the phone does.
 * An *accordion* expands in flow — "Show tools", a why-explainer, a CAD
 * activity row opening its detail — and closing one of those because you
 * clicked a button beside it would lose the section you just opened. A first
 * pass at this test counted every `aria-expanded` and called twelve panels
 * broken; most of them were accordions, and "fixing" them would have been a
 * regression.
 *
 * So the rule is scoped by what the CSS does: only classes the stylesheets
 * position `absolute` or `fixed` are held to it.
 */

const WEB_ROOT = join(__dirname, "..");
const APP = join(WEB_ROOT, "app");
const COMPONENTS = join(WEB_ROOT, "components");

function filesIn(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesIn(full, ext, out);
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

/**
 * Utilities that are positioned but are not panels. A screen-reader-only span
 * is `position: absolute` and appears in half the files in the app; counting it
 * as "this component has a floating menu" flagged the Bugbot scan-coverage
 * accordion, which expands a file list in flow.
 */
const POSITIONED_UTILITIES = new Set(["visually-hidden", "sr-only", "skip-link"]);

/** Every class the stylesheets take out of normal flow. */
function floatingClasses(): Set<string> {
  const floating = new Set<string>();
  for (const css of filesIn(APP, ".css")) {
    const text = readFileSync(css, "utf8");
    for (const rule of text.matchAll(/\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g)) {
      const name = rule[1] as string;
      if (POSITIONED_UTILITIES.has(name)) continue;
      if (/position\s*:\s*(absolute|fixed)/.test(rule[2] as string)) floating.add(name);
    }
  }
  return floating;
}

/**
 * Files whose floating class is not the disclosure's panel. The scan is
 * textual — it sees "this file mentions a class the CSS positions fixed" — and
 * cannot tell that from "this file's menu is fixed". Both were checked by
 * opening the menu in a browser and clicking away from it.
 */
const NOT_A_PANEL: Record<string, string> = {
  // Matches on dash-drag-proxy / dash-drop-slot, the widget drag affordances.
  // The only disclosure here is the board bar, which expands in flow.
  "app/dashboard/dashboard-home-view.tsx": "drag-and-drop affordances, not a menu",
  // Matches on .soft-topbar itself (position: fixed). The account menu it
  // contains is dismissed by .soft-account-scrim, rendered from app-shell.tsx.
  // Verified: opened the avatar menu, clicked the page, menu closed.
  "components/app-shell-topbar.tsx": "the bar is fixed; its menu has a scrim next door",
};

/** Routes out of an open panel that are not its own trigger. */
function hasEscapeRoute(src: string): boolean {
  return (
    /useDismiss\s*[(<]/.test(src) ||
    /<Modal\b/.test(src) ||
    /scrim|backdrop/i.test(src) ||
    /["']Escape["']/.test(src) ||
    /addEventListener\(\s*["'](?:pointerdown|mousedown|click|focusin)["']/.test(src)
  );
}

describe("floating panels can be dismissed without their trigger", () => {
  it("finds no floating panel whose only way out is the button that opened it", () => {
    const floating = floatingClasses();
    const offenders: string[] = [];

    for (const file of [...filesIn(APP, ".tsx"), ...filesIn(COMPONENTS, ".tsx")]) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("aria-expanded")) continue;
      if (hasEscapeRoute(src)) continue;

      const classes = [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
        .flatMap((match) => (match[1] ?? match[2] ?? "").split(/[\s${}?:]+/))
        .filter(Boolean);
      const rel = relative(WEB_ROOT, file).replace(/\\/g, "/");
      if (rel in NOT_A_PANEL) continue;
      if (classes.some((name) => floating.has(name))) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it("knows a floating class from an inline one, so the rule stays scoped", () => {
    // Guards the guard. If floatingClasses() ever came back empty the test
    // above would pass across the whole app while checking nothing.
    const floating = floatingClasses();
    expect(floating.size).toBeGreaterThan(20);
    expect(floating.has("soft-topbar")).toBe(true); // position: fixed
    // `.product-hub-more` is a <details> that pushes the page down when it
    // opens — the accordion case this rule must not catch.
    //
    // This used to name `hub-tool-overflow`, which was the in-flow example
    // until the hub chrome collapsed into one row: a list that expands in flow
    // has nowhere to go inside a single-line bar, so it became a dropdown
    // positioned against it. The rule then started applying to it, which is
    // correct — and `ToolStrip` already closes it on an outside click through
    // `useDismiss`, which is why the scan above still reports no offenders.
    expect(floating.has("product-hub-more")).toBe(false);
    expect(floating.has("hub-tool-overflow")).toBe(true); // now a dropdown
  });

  it("keeps the allowlist honest — every entry still exists and still matches", () => {
    // An allowlist that outlives the files it excuses is how a guard rots into
    // a rubber stamp.
    const all = [...filesIn(APP, ".tsx"), ...filesIn(COMPONENTS, ".tsx")].map((file) =>
      relative(WEB_ROOT, file).replace(/\\/g, "/"),
    );
    for (const entry of Object.keys(NOT_A_PANEL)) {
      expect(all, `${entry} is allowlisted but no longer exists`).toContain(entry);
    }
  });

  it("counts the shared hook as a way out", () => {
    expect(hasEscapeRoute("const ref = useDismiss(open, close);")).toBe(true);
    expect(hasEscapeRoute('<button aria-expanded={open} onClick={toggle} />')).toBe(false);
  });
});
