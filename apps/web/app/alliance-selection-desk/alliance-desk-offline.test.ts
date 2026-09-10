import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Alliance selection desk last snapshot stays on the phone", () => {
  it("reads and writes the alliance-desk IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "alliance-selection-desk-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"alliance-desk"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Alliance selection desk"/);
  });
});
