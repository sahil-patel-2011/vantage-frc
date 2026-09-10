import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Match Simulator last snapshot stays on the phone", () => {
  it("reads and writes the match-sim IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "match-sim-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"match-sim"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Match Simulator"/);
  });
});
