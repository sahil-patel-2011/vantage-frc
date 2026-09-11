import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Mock Judging last snapshot stays on the phone", () => {
  it("reads and writes the mock-judging IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "mock-judging-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"mock-judging"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Mock Judging"/);
  });
});
