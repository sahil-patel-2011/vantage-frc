import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Get unstuck last snapshot stays on the phone", () => {
  it("reads and writes the troubleshoot IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "troubleshoot-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"troubleshoot"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Get unstuck"/);
    expect(src).toMatch(/failure && !view/);
  });
});
