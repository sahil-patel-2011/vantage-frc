import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Pit map last snapshot stays on the phone", () => {
  it("reads and writes the pit-map IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "pit-map-planner-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"pit-map"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Pit map"/);
  });
});
