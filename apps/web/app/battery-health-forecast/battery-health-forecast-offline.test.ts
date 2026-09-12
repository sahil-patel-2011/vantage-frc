import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Pack health last snapshot stays on the phone", () => {
  it("reads and writes the battery-health-forecast IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "battery-health-forecast-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"battery-health-forecast"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Pack health"/);
  });
});
