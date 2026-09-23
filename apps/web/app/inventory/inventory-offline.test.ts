import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Inventory last snapshot stays on the phone", () => {
  it("reads and writes the inventory IndexedDB feature cache", () => {
    const src = [
      readFileSync(join(DIR, "inventory-client.tsx"), "utf8"),
      readFileSync(join(DIR, "inventory-chrome.tsx"), "utf8"),
      readFileSync(join(DIR, "../api/inventory/route.ts"), "utf8"),
    ].join("\n");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"inventory"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Inventory"/);
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
  });
});
