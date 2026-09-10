import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Equipment Maintenance last snapshot stays on the phone", () => {
  it("reads and writes the equipment-maintenance IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "equipment-maintenance-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"equipment-maintenance"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Equipment Maintenance"/);
  });
});
