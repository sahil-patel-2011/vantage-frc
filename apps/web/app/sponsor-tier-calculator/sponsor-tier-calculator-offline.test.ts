import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Tier calculator last snapshot stays on the phone", () => {
  it("reads and writes the sponsor-tier-calculator IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "sponsor-tier-calculator-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"sponsor-tier-calculator"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Tier calculator"/);
  });
});
