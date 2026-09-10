import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Robot weigh-in last snapshot stays on the phone", () => {
  it("reads and writes the weigh-in IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "robot-weigh-in-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"weigh-in"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Robot weigh-in"/);
  });
});
