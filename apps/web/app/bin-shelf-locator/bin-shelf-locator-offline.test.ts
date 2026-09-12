import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Bin locator last snapshot stays on the phone", () => {
  it("reads and writes the bin-shelf-locator IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "bin-shelf-locator-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"bin-shelf-locator"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Bin locator"/);
  });
});
