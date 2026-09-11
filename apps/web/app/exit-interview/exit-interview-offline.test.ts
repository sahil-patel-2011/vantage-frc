import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Exit Interviews last snapshot stays on the phone", () => {
  it("reads and writes the exit-interview IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "exit-interview-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"exit-interview"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Exit Interviews"/);
  });
});
