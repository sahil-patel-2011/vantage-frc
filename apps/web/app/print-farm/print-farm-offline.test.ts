import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Print Farm last snapshot stays on the phone", () => {
  it("reads and writes the print-farm IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "print-farm-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"print-farm"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Print Farm"/);
  });
});
