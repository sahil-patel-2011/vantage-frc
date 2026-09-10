import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("CAD Change Radar last snapshot stays on the phone", () => {
  it("reads and writes the cad-change-radar IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "cad-change-radar-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"cad-change-radar"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="CAD Change Radar"/);
  });
});
