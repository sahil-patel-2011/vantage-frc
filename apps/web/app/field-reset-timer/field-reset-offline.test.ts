import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Field reset timer last snapshot stays on the phone", () => {
  it("reads and writes the field-reset IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "field-reset-timer-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"field-reset"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Field reset timer"/);
  });
});
