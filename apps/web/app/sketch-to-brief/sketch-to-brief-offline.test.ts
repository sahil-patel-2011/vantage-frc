import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Sketch to brief last snapshot stays on the phone", () => {
  it("reads and writes the sketch-to-brief IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "sketch-to-brief-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"sketch-to-brief"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Sketch to brief"/);
  });
});
