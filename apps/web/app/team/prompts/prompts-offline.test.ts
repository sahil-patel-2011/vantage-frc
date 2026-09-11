import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Prompts last snapshot stays on the phone", () => {
  it("reads and writes the prompts IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "prompts-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"prompts"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Prompts"/);
    expect(src).not.toMatch(/VANTAGE \//);
  });
});
