/**
 * iPhone Safari zooms the page when a text field under 16px takes focus. system.css sets every
 * field to 16px on a touch screen, except the fields that are larger on purpose. This keeps that
 * exception list complete: a field styled above 16px that is missing from it would be shrunk to
 * 16px on phones.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");
const ROOTS = [join(WEB, "app"), join(WEB, "components")];

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (entry.endsWith(".css")) acc.push(full);
  }
  return acc;
}

/** The smallest size a font or font-size value can be, in px, or null when it can't be read. */
function minPx(body: string): number | null {
  const size = /(?<![-\w])font-size\s*:\s*([^;}]+)/.exec(body)?.[1] ?? /(?<![-\w])font\s*:\s*([^;}]+)/.exec(body)?.[1];
  if (!size) return null;
  const px = /(?:^|[\s(/])([\d.]+)px/.exec(size);
  if (px) return Number(px[1]);
  const rem = /(?:^|[\s(/])([\d.]+)rem/.exec(size);
  return rem ? Number(rem[1]) * 16 : null;
}

const FIELD = /(?:^|[\s>+~])(?:input|select|textarea)(?:[[:.]|$)|-input$/;
const NOT_TEXT = /checkbox|radio|range|::placeholder|label/;

describe("touch text fields stay at 16px or more", () => {
  const system = readFileSync(join(WEB, "app", "system.css"), "utf8");
  const floor = /font-size:\s*16px\s*!important/.exec(system);
  const exceptions = /\):not\(([^{]*)\)\s*\{\s*font-size:\s*16px\s*!important/.exec(system)?.[1] ?? "";
  const excepted = new Set(exceptions.split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean));

  it("system.css has the touch floor", () => {
    expect(floor).not.toBeNull();
    expect(excepted.size).toBeGreaterThan(0);
  });

  it("lists every field that is styled larger than 16px", () => {
    const missing: string[] = [];
    for (const file of ROOTS.flatMap((root) => collect(root))) {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [, selectorList = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const size = minPx(body);
        if (size === null || size <= 16) continue;
        for (const raw of selectorList.split(",")) {
          const selector = raw.replace(/\s+/g, " ").trim();
          if (!FIELD.test(selector) || NOT_TEXT.test(selector) || selector.startsWith("@")) continue;
          // A field's own state (:focus, :disabled) is covered by the field itself.
          const base = selector.replace(/:(?:focus|focus-visible|hover|disabled|not\(\[type\]\))$/, "");
          // ".scout-answer-fields .tap-counter input" is still a ".tap-counter input".
          const covered = [...excepted].some(
            (entry) => base === entry || base.endsWith(` ${entry}`) || base.startsWith(`${entry}[`),
          );
          if (!covered) missing.push(`${file.replace(WEB, "")}: ${selector} (${size}px)`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
