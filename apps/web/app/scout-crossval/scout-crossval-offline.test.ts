import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Cross-check last snapshot stays on the phone", () => {
  it("reads and writes the scout-crossval IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "scout-crossval-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"scout-crossval"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Cross-check"/);
  });
});
