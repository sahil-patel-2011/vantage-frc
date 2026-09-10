import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Grant Report last snapshot stays on the phone", () => {
  it("reads and writes the grant-report IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "grant-report-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"grant-report"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Grant Report"/);
  });
});
