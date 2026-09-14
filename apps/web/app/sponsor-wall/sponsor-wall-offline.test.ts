import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Sponsor wall last snapshot stays on the phone", () => {
  it("reads and writes the sponsor-wall IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "sponsor-wall-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"sponsor-wall"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Sponsor wall"/);
  });
});
