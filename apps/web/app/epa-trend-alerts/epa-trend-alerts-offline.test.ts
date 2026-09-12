import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Rating alerts last snapshot stays on the phone", () => {
  it("reads and writes the epa-trend IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "epa-trend-alerts-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"epa-trend"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Rating alerts"/);
  });
});
