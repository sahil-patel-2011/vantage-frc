import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Robot last snapshot stays on the phone", () => {
  it("reads and writes the robot IndexedDB feature cache", () => {
    const src = [
      readFileSync(join(DIR, "robot-client.tsx"), "utf8"),
      readFileSync(join(DIR, "../api/robot/route.ts"), "utf8"),
    ].join("\n");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"robot"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Robot"/);
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
    expect(src).toContain("Choose your team to open the robot blueprint, or join the waitlist.");
    expect(src).toContain("Choose your team to open the robot blueprint.");
  });
});
