import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Safety Training last snapshot stays on the phone", () => {
  it("reads and writes the safety-training IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "safety-training-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"safety-training"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Safety Training"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/!view/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
