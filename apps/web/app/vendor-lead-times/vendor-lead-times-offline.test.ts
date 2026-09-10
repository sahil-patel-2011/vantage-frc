import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Vendor Lead Times last snapshot stays on the phone", () => {
  it("reads and writes the vendor-lead-times IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "vendor-lead-times-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"vendor-lead-times"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Vendor Lead Times"/);
  });
});
