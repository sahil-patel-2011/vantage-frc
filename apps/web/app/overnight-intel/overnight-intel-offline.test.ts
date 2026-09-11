import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Overnight Intel last snapshot stays on the phone", () => {
  it("reads and writes the overnight-intel IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "overnight-intel-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"overnight-intel"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Overnight brief"/);
    expect(src).toMatch(/shell === "ready" \? <OvernightNextActionsPanel/);
  });
});
