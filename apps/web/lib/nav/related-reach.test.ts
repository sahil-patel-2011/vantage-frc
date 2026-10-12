import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandCatalog } from "./command-search";
import { PRODUCT_HUBS } from "./hubs";

/** Every `path: "/x"` a related-links strip pointed at. */
function relatedPaths(): string[] {
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/related\.ts$/.test(name) && !name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(root);
  const paths = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(/path:\s*"(\/[^"]*)"/g)) paths.add(match[1]!.split("#")[0]!);
  }
  return [...paths].sort();
}

describe("related-link strips are gone from page headers, not their destinations", () => {
  it("every page a strip used to link to is still found by search", () => {
    const catalog = commandCatalog();
    const reachable = new Set<string>();
    for (const entry of catalog) {
      for (const href of [entry.href, ...(entry.alternativeHrefs ?? [])]) {
        const url = new URL(href, "https://vantage.local");
        reachable.add(url.pathname);
        reachable.add(url.pathname + url.search);
      }
    }
    // A hub tab that shows a standalone page inside the workspace is reached through that tab.
    for (const hub of PRODUCT_HUBS) {
      for (const tab of hub.tabs) {
        if (!tab.legacyHref) continue;
        const url = new URL(tab.legacyHref, "https://vantage.local");
        reachable.add(url.pathname);
        reachable.add(url.pathname + url.search);
      }
    }
    // Flows somebody is sent through, not places they look for.
    const flows = new Set(["/onboarding", "/workspace"]);
    const missing = relatedPaths().filter((path) => {
      if (flows.has(path)) return false;
      const url = new URL(path, "https://vantage.local");
      return !reachable.has(url.pathname + url.search) && !reachable.has(url.pathname);
    });
    expect(missing).toEqual([]);
  });
});
