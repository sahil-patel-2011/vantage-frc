import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Coverage last snapshot stays on the phone", () => {
  it("reads and writes the scout-coverage-live IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "scout-coverage-live-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"scout-coverage-live"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Coverage"/);
  });
});
