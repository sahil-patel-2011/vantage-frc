import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Prototype-to-Decision Tracker last snapshot stays on the phone", () => {
  it("reads and writes the prototype-tracker IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "prototype-tracker-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"prototype-tracker"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Prototype-to-Decision Tracker"/);
  });
});
