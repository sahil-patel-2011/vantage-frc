import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Tool checkout last snapshot stays on the phone", () => {
  it("reads and writes the tool-checkout IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "tool-checkout-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"tool-checkout"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Tool checkout"/);
  });
});
