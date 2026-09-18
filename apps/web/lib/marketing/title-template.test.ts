import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The root layout sets `template: "%s — Vantage"`, so every page title gets
 * the product name appended for it. A page that writes its own gets it twice:
 * "Pit Command — Vantage — Vantage" was the browser tab, the bookmark and the
 * history entry, and "Team schedule — Vantage — Vantage" was what a team sent
 * to its parents.
 *
 * `marketingPageMetadata` is exempt — it sets `title: { absolute }`, which is
 * the documented way to opt out of the template, and those pages read
 * correctly.
 */
const APP_ROOT = join(__dirname, "..", "..", "app");
const ROOT_LAYOUT = join(APP_ROOT, "layout.tsx");

function collectPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectPages(full));
      continue;
    }
    if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** A plain `title: "…"` — not `title: { absolute: "…" }`. */
const PLAIN_TITLE = /(^|[^.\w])title:\s*"([^"]+)"/g;

const files = collectPages(APP_ROOT);

describe("page titles", () => {
  it("finds the app's pages", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("the root layout still appends the product name", () => {
    // If this template ever goes away the rule below is wrong, not the pages.
    expect(readFileSync(ROOT_LAYOUT, "utf8") + readFileSync(join(__dirname, "seo.ts"), "utf8")).toContain(
      'template: "%s — Vantage"',
    );
  });

  it("no page appends the product name the template already adds", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Pages that opt out of the template entirely are free to spell it out.
      if (source.includes("marketingPageMetadata(") || source.includes("absolute:")) continue;

      for (const match of source.matchAll(PLAIN_TITLE)) {
        const value = match[2]!;
        if (!/[—-]\s*Vantage\s*$/.test(value)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`apps/web/app/${relative(APP_ROOT, file).split(sep).join("/")}:${line}  ${value}`);
      }
    }

    expect(
      offenders.join("\n"),
      `\n${offenders.length} title(s) end in "— Vantage" under a layout that already appends it,\n` +
        `so the tab reads "… — Vantage — Vantage". Drop the suffix, or use\n` +
        `marketingPageMetadata / title: { absolute } to opt out of the template:\n${offenders.join("\n")}\n`,
    ).toBe("");
  });
});
