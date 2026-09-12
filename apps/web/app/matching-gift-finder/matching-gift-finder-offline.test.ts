import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Matching gifts last snapshot stays on the phone", () => {
  it("reads and writes the matching-gift-finder IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "matching-gift-finder-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"matching-gift-finder"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Matching gifts"/);
  });
});
