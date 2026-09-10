import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Onboarding Buddy last snapshot stays on the phone", () => {
  it("reads and writes the onboarding-buddy IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "onboarding-buddy-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"onboarding-buddy"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Onboarding Buddy"/);
  });
});
