import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Team Health last snapshot stays on the phone", () => {
  it("reads and writes the team-health-dashboard IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "team-health-dashboard-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"team-health-dashboard"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Team Health"/);
  });
});
