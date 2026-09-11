import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("AI keys last snapshot stays on the phone", () => {
  it("reads and writes the ai-keys IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "ai-keys-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"ai-keys"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="AI keys"/);
  });
});
