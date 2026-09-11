import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Data Quality Scorecard last snapshot stays on the phone", () => {
  it("reads and writes the data-quality-scorecard IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "data-quality-scorecard-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"data-quality-scorecard"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Data Quality Scorecard"/);
  });
});
