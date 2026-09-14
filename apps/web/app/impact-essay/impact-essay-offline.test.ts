import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Impact essay last snapshot stays on the phone", () => {
  it("reads and writes the impact-essay IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "impact-essay-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"impact-essay"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Impact essay"/);
  });
});
