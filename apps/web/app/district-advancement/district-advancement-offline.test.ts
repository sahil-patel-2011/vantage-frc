import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("District advancement last snapshot stays on the phone", () => {
  it("reads and writes the district-advancement IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "district-advancement-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"district-advancement"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="District advancement"/);
  });
});
