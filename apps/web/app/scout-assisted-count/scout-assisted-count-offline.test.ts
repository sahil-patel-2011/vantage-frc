import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Scout-Assisted Count last snapshot stays on the phone", () => {
  it("reads and writes the scout-assisted-count IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "scout-assisted-count-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"scout-assisted-count"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Scout-Assisted Count"/);
  });
});
