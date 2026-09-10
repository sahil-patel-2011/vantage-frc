import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Build Burndown last snapshot stays on the phone", () => {
  it("reads and writes the build-burndown IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "build-burndown-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"build-burndown"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Build Burndown"/);
  });
});
