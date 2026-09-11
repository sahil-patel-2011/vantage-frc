import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Pick desk last snapshot stays on the phone", () => {
  it("reads and writes the pick-desk IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "pick-list-workbench.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"pick-desk"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Pick desk"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/response\.status === 401 \|\| response\.status === 403/);
  });
});
