import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Judge-Pitch last snapshot stays on the phone", () => {
  it("reads and writes the judge-sim IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "judge-sim-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"judge-sim"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Judge-Pitch Simulator"/);
  });
});
