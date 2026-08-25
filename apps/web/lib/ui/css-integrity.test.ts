/**
 * CSS integrity guard.
 *
 * Commit 80859a3 dropped a `.tc-mode {` selector line, leaving its declarations
 * outside any rule. Next's CSS parser rejected the whole file, and because that
 * stylesheet is in the product-shell import chain, /team, /build, /account and
 * /ai all returned HTTP 500. Neither typecheck nor any unit test noticed.
 *
 * These checks catch that shape of breakage without needing a browser.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = [join(__dirname, "..", "..", "app"), join(__dirname, "..", "..", "components")];

function collectCss(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collectCss(full, acc);
    else if (entry.endsWith(".css")) acc.push(full);
  }
  return acc;
}

const files = ROOTS.flatMap((root) => collectCss(root));

/** Strip comments and string/url contents so braces inside them do not count. */
function scrub(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

describe("stylesheet integrity", () => {
  it("finds the app's stylesheets", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("has balanced braces in every stylesheet", () => {
    const broken: string[] = [];
    for (const file of files) {
      const text = scrub(readFileSync(file, "utf8"));
      let depth = 0;
      let negative = false;
      for (const char of text) {
        if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth < 0) negative = true;
        }
      }
      if (depth !== 0 || negative) {
        broken.push(`${file} (ends at depth ${depth}${negative ? ", closed too many" : ""})`);
      }
    }
    expect(broken, `unbalanced braces:\n  ${broken.join("\n  ")}`).toEqual([]);
  });

  it("has no declaration sitting outside a rule", () => {
    // This is the exact failure that 500'd four hubs.
    const orphans: string[] = [];
    for (const file of files) {
      const text = scrub(readFileSync(file, "utf8"));
      let depth = 0;
      let line = 1;
      let buffer = "";
      for (const char of text) {
        if (char === "\n") {
          line += 1;
          buffer = "";
          continue;
        }
        if (char === "{") {
          depth += 1;
          buffer = "";
          continue;
        }
        if (char === "}") {
          depth = Math.max(0, depth - 1);
          buffer = "";
          continue;
        }
        if (char === ";" && depth === 0) {
          const text = buffer.trim();
          // At depth 0 a semicolon is only legal after an at-rule (@import, @charset).
          if (text && !text.startsWith("@")) {
            orphans.push(`${file}:${line} — "${text.slice(0, 60)}"`);
          }
          buffer = "";
          continue;
        }
        buffer += char;
      }
    }
    expect(orphans, `declarations outside any rule:\n  ${orphans.join("\n  ")}`).toEqual([]);
  });

  it("keeps the stylesheet that once broke four hubs parseable", () => {
    const calendar = files.find((file) => file.endsWith("team-calendar.css"));
    expect(calendar).toBeDefined();
    const text = readFileSync(calendar!, "utf8");
    expect(text).toContain(".tc-mode {");
  });
});
