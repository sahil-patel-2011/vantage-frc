import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Strategy last snapshot stays on the phone", () => {
  it("reads and writes the strategy IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "strategy-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"strategy"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Strategy"/);
    expect(src).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(src).toMatch(/orgId\?\.trim\(\) \|\| "_"/);
    expect(src).toMatch(/putFeatureSnapshot\("strategy", "_"/);
    expect(src).toMatch(/clearFeatureSnapshot\("strategy"/);
  });
});
