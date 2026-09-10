import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Drive-team signals last snapshot stays on the phone", () => {
  it("reads and writes the drive-signals IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "drive-team-signals-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"drive-signals"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Drive-team signals"/);
  });
});
