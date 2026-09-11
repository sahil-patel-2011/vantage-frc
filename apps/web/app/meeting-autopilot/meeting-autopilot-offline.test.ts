import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Meeting-agenda autopilot last snapshot stays on the phone", () => {
  it("reads and writes the meeting-autopilot IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "meeting-autopilot-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"meeting-autopilot"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Meeting-agenda autopilot"/);
  });
});
