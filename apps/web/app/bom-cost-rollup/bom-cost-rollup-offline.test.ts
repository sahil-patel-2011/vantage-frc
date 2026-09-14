import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("BOM cost last snapshot stays on the phone", () => {
  it("reads and writes the bom-cost-rollup IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "bom-cost-rollup-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"bom-cost-rollup"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="BOM cost"/);
  });
});
