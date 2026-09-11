import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Slack last snapshot stays on the phone", () => {
  it("reads and writes the slack IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "slack-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"slack"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Slack"/);
    expect(src).toMatch(/failure && !view/);
  });
});
