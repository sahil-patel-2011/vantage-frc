import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Grant Eligibility Matcher last snapshot stays on the phone", () => {
  it("reads and writes the grant-eligibility-matcher IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "grant-eligibility-matcher-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"grant-eligibility-matcher"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Grant Eligibility Matcher"/);
  });
});
