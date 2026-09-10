import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Fundraisers last snapshot stays on the phone", () => {
  it("reads and writes the fundraisers IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "fundraisers-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"fundraisers"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Fundraisers"/);
  });
});
