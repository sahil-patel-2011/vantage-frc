import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Sponsor suite last snapshot stays on the phone", () => {
  it("reads and writes the sponsor-suite IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "sponsor-suite-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"sponsor-suite"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Sponsor suite"/);
  });
});
