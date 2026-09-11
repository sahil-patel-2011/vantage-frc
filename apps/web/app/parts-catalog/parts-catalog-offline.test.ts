import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Parts catalog last snapshot stays on the phone", () => {
  it("reads and writes the parts-catalog IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "parts-catalog-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"parts-catalog"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Parts catalog"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
  });
});
