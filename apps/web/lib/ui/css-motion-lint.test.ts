/**
 * Two stylesheet rules that are invisible until someone looks at a rendered
 * page with devtools open, which is to say: until a user complains.
 *
 * 1. Never hand-write `-webkit-backdrop-filter`. It looks like carefulness and
 *    it is the opposite. Lightning CSS (Next's transformer) emits ONLY the
 *    prefixed property when the source declares both, and no current browser
 *    supports the prefixed form — `CSS.supports('-webkit-backdrop-filter',
 *    'blur(1px)')` is false in Chrome, Edge and Firefox. Every glass surface
 *    written the "safe" way shipped translucent with no blur, which is harder
 *    to read than either glass or a flat colour. The build adds prefixes for
 *    the targets that need them; the source declares the standard property.
 *
 * 2. Easing curves come from the tokens in vantage-fluid.css. The product had
 *    five hardcoded curves, three of them the same shape written three ways,
 *    which is why nothing shared a rhythm.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");
const APP = join(WEB_ROOT, "app");

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (full.endsWith(".css")) out.push(full);
  }
  return out;
}

/**
 * Blank out comment bodies but keep the newlines, so line numbers still point
 * at the real line. Without this the rules below fire on the comments that
 * explain them, which is a special kind of annoying.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

function hits(pattern: RegExp, skipFile?: string): string[] {
  const found: string[] = [];
  for (const file of cssFiles(APP)) {
    if (skipFile && file.endsWith(skipFile)) continue;
    const lines = withoutComments(readFileSync(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        found.push(`${relative(WEB_ROOT, file)}:${index + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }
  return found;
}

describe("stylesheet guards", () => {
  it("never hand-writes -webkit-backdrop-filter", () => {
    // Declaring both makes the build drop the one that actually works.
    expect(hits(/-webkit-backdrop-filter/)).toEqual([]);
  });

  it("still uses the standard backdrop-filter somewhere", () => {
    // Guards the guard: a sweep that deleted every glass surface would leave
    // the rule above passing and the product flat.
    expect(hits(/[^-]backdrop-filter\s*:/).length).toBeGreaterThan(5);
  });

  it("takes easing from the tokens rather than hardcoding curves", () => {
    // vantage-fluid.css is where the four curves are defined, so it is the one
    // file allowed to write one.
    expect(hits(/cubic-bezier\(/, "vantage-fluid.css")).toEqual([]);
  });

  it("does not multiply a duration by --motion", () => {
    // --motion is declared as `1` in system.css and as `240ms` in soft-ui.css.
    // soft-ui wins, so `calc(var(--motion) * 260ms)` is time times time, which
    // is invalid, which silently disables the transition it was scaling.
    expect(hits(/calc\(\s*var\(--motion\b[^)]*\)\s*\*/)).toEqual([]);
  });
});
