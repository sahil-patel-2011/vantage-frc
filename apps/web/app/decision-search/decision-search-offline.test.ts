import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Decision Search last snapshot stays on the phone", () => {
  it("reads and writes the decision-search IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "decision-search-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"decision-search"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Decision Search"/);
  });
});
