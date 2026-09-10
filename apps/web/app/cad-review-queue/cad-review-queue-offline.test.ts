import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("CAD Review Queue last snapshot stays on the phone", () => {
  it("reads and writes the cad-review-queue IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "cad-review-queue-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"cad-review-queue"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="CAD Review Queue"/);
  });
});
