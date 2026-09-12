import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Shifts last snapshot stays on the phone", () => {
  it("reads and writes the shift-balancer IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "shift-balancer-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"shift-balancer"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Shifts"/);
  });
});
