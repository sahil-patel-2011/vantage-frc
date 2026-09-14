import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Accuracy last snapshot stays on the phone", () => {
  it("reads and writes the scout-accuracy IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "scout-accuracy-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"scout-accuracy"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Accuracy"/);
  });
});
