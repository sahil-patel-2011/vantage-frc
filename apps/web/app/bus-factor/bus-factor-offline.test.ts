import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Bus-Factor last snapshot stays on the phone", () => {
  it("reads and writes the bus-factor IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "bus-factor-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"bus-factor"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Bus factor"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/fetchFailed && view == null/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
