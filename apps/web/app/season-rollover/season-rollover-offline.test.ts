import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Season rollover last snapshot stays on the phone", () => {
  it("reads and writes the season-rollover IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "season-rollover-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"season-rollover"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Season rollover"/);
  });
});
