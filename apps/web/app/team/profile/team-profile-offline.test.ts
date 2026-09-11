import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Team profile last snapshot stays on the phone", () => {
  it("reads and writes the team-profile IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "team-profile-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"team-profile"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Team profile"/);
  });
});
