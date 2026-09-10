import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Assembly manual last snapshot stays on the phone", () => {
  it("reads and writes the assembly-manual IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "assembly-manual-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"assembly-manual"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Assembly manual"/);
  });
});
