import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  A6-04 field boundaries, A6-07 text contrast, A6-08 touch targets, A6-24 small type, A6-27
  disabled primary. The numbers are computed from the real tokens, so a palette change that
  breaks a ratio fails here rather than in a pit in bright light.
*/

const WEB = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");
const clarity = read("app/shell-clarity.css");
const macos = read("app/macos-product.css");

type Rgb = [number, number, number];
const hex = (value: string): Rgb => {
  const h = value.replace("#", "");
  return [0, 2, 4].map((index) => parseInt(h.slice(index, index + 2), 16)) as Rgb;
};
const channel = (value: number) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** color-mix(in srgb, a p%, b) */
const mix = (a: Rgb, b: Rgb, p: number): Rgb => a.map((v, i) => v * p + b[i]! * (1 - p)) as Rgb;

/** The product palette for one theme, as macos-product.css declares it. */
function palette(theme: "light" | "dark") {
  const line = macos.split("\n").find((row) => row.startsWith(`html[data-theme="${theme}"] :is(body.has-app-shell,.scouting-product) {`));
  expect(line, `${theme} product tokens`).toBeDefined();
  const token = (name: string) => hex(line!.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))![1]!);
  return { bg: token("bg"), surface: token("surface"), surface2: token("surface-2"), ink: token("ink") };
}
const mixPercent = (selectorStart: string) => {
  const at = clarity.indexOf(selectorStart);
  const match = clarity.slice(at).match(/--field-line: color-mix\(in srgb, var\(--ink\) (\d+)%, var\(--surface\)\);/);
  expect(match, selectorStart).not.toBeNull();
  return Number(match![1]) / 100;
};

describe("form field boundaries (A6-04)", () => {
  it("are at least 3:1 against every surface a field sits on, in both themes", () => {
    const cases = [
      { theme: "light" as const, p: mixPercent(":is(body.has-app-shell, .scouting-product) {") },
      { theme: "dark" as const, p: mixPercent('html[data-theme="dark"] :is(body.has-app-shell, .scouting-product) {') },
    ];
    for (const { theme, p } of cases) {
      const t = palette(theme);
      const fieldLine = mix(t.ink, t.surface, p);
      for (const [name, against] of Object.entries({ bg: t.bg, surface: t.surface, surface2: t.surface2 })) {
        expect(ratio(fieldLine, against), `${theme} field line on ${name}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("is what every field's own border reads", () => {
    expect(clarity).toMatch(/:is\(body\.has-app-shell, \.scouting-product\) :is\(input:not\([^)]*\), select, textarea, \.soft-panel-search\) \{\n {2}--line: var\(--field-line\);/);
  });
});

describe("text contrast on match-day screens (A6-07)", () => {
  it("Quick scout tiles put white text on fills that pass 4.5:1 in both themes", () => {
    const red = clarity.match(/--qs-red: (#[0-9a-f]{6});/)![1]!;
    const blue = clarity.match(/--qs-blue: (#[0-9a-f]{6});/)![1]!;
    expect(ratio(hex("#ffffff"), hex(red))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex("#ffffff"), hex(blue))).toBeGreaterThanOrEqual(4.5);
    expect(clarity).toMatch(/\.scouting-product \.qs-robot small \{ opacity: 1; \}/);
    expect(clarity).toMatch(/\.scouting-product \.qs-robot\.is-done \{ opacity: 1; color: var\(--ink\); \}/);
  });

  it("no longer fades text to say done, played or another month", () => {
    expect(clarity).toMatch(/\.qs-row\.is-done \{ opacity: 1;/);
    expect(clarity).toMatch(/\.cal-grid-day\[data-in-month="no"\] \.cal-grid-num \{ opacity: 1; \}/);
    expect(clarity).toMatch(/\.myday-card\.played \{ opacity: 1;/);
    expect(clarity).toMatch(/\.pit-empty \{ color: var\(--ink\); \}/);
  });

  it("Tasks' due tones follow the theme", () => {
    const todos = read("app/todos/todos-client.tsx");
    expect(todos).toMatch(/tone: "var\(--critical\)"/);
    expect(todos).toMatch(/tone: "var\(--warning\)"/);
    expect(todos).not.toMatch(/tone: "#c02626"/);
  });

  it("a disabled primary is flat and legible, not a faded accent (A6-27)", () => {
    expect(clarity).toMatch(/:is\(\.app-button, \.app-button\.primary, \.app-button\.is-primary\):is\(:disabled, \[aria-disabled="true"\]\) \{\n {2}opacity: 1;/);
  });
});

describe("touch targets and small type (A6-08, A6-24)", () => {
  it("the avatar button is 44×44 around a 34px circle", () => {
    expect(clarity).toMatch(/\.soft-avatar\.soft-avatar-btn \{[^}]*width: 44px;[^}]*height: 44px;/);
    expect(clarity).toMatch(/\.soft-avatar\.soft-avatar-btn::before \{[^}]*inset: 5px;/);
  });

  it("breadcrumbs, related links, disclosure rows and the Scouting tabs grow on touch", () => {
    const coarse = clarity.slice(clarity.indexOf("@media (pointer: coarse)"));
    expect(coarse).toMatch(/\.breadcrumbs a \{\n {4}padding: 13px 8px;/);
    expect(coarse).toMatch(/\.cdc-gov a, \.product-hub-related a/);
    expect(coarse).toMatch(/summary \{\n {4}min-height: 44px;/);
    expect(coarse).toMatch(/\.scouting-tabs a \{ min-width: 44px; \}/);
  });

  it("Robot status and Shop hours have no text under 11px", () => {
    const tiny = /font-size: ?(?:9|9\.5|10|10\.5)px|font: ?\d+ (?:9|9\.5|10|10\.5)px/;
    expect(read("app/pit/pit-command.css")).not.toMatch(tiny);
    expect(read("app/hours/hours.css")).not.toMatch(tiny);
  });
});
