import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Deploy log last snapshot stays on the phone", () => {
  it("reads and writes the code-deploy-log IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "code-deploy-log-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"code-deploy-log"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Deploy log"/);
  });
});
