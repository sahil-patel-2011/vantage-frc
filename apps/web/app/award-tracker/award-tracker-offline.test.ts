import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Award Tracker last snapshot stays on the phone", () => {
  it("reads and writes the award-tracker IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "award-tracker-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"award-tracker"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Award Tracker"/);
  });
});
