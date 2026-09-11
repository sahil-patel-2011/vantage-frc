import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Data-source health last snapshot stays on the phone", () => {
  it("reads and writes the degraded-mode IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "degraded-mode-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"degraded-mode"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Data-source health"/);
  });
});
