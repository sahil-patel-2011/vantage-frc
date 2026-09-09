/**
 * No module a client component can reach may import `@vantage/db`.
 *
 * `@vantage/db` builds a `pg` pool at import time, so pulling it into a browser
 * bundle fails the Turbopack build with "Can't resolve 'net' / 'tls' / 'dns'" —
 * a message several layers away from the import that caused it. That happened
 * twice while adding savepoints to `lib/**`: `cockpit/prefs.ts` is imported by
 * the account appearance panel, and `tool-checkout/compute-tool-checkout.ts` is
 * value-imported by `tool-checkout-client.tsx` for TOOL_CATEGORIES. Both took a
 * full production build to notice.
 *
 * This is the same boundary the lint rule draws around `@vantage/db/admin`,
 * enforced from the other direction: reachability rather than a file glob. The
 * fix when it fires is to split the database function into its own module (see
 * `cockpit/load-prefs.ts`), not to loosen the test.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "dist"].includes(entry.name)) continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Only imports that survive type erasure can drag a module into the bundle. */
function valueImports(source: string, file: string): string[] {
  const found: string[] = [];
  const pattern = /(^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)from\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match[2]) continue; // `import type … from`
    const clause = match[3] ?? "";
    const named = clause.match(/\{([^}]*)\}/);
    if (named && !/\*|default/.test(clause.replace(named[0], ""))) {
      const parts = named[1]!.split(",").map((part) => part.trim()).filter(Boolean);
      // `import { type A, type B }` is erased too.
      if (parts.length && parts.every((part) => part.startsWith("type "))) continue;
    }
    const target = resolveSpecifier(file, match[4]!);
    if (target) found.push(target);
  }
  return found;
}

describe("client bundle boundary", () => {
  it("keeps @vantage/db out of every module a client component can reach", () => {
    const files = walk(WEB);
    const clientRoots = files.filter((file) =>
      /^\s*["']use client["']/m.test(readFileSync(file, "utf8")),
    );
    expect(clientRoots.length).toBeGreaterThan(50);

    const reached = new Set<string>();
    const queue = [...clientRoots];
    while (queue.length) {
      const file = queue.pop()!;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const dependency of valueImports(readFileSync(file, "utf8"), file)) {
        if (!reached.has(dependency)) queue.push(dependency);
      }
    }

    const offenders = [...reached]
      .filter((file) => /from\s*["']@vantage\/db/.test(readFileSync(file, "utf8")))
      .map((file) => relative(WEB, file).replace(/\\/g, "/"))
      .sort();

    expect(offenders).toEqual([]);
  }, 60_000);
});
