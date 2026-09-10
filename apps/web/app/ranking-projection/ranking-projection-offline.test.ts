import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Ranking projection last snapshot stays on the phone", () => {
  it("reads and writes the ranking-projection IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "ranking-projection-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"ranking-projection"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Ranking projection"/);
  });
});
