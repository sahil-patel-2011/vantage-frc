import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Your keys usage last snapshot stays on the phone", () => {
  it("reads and writes the ai-usage IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "ai-usage-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"ai-usage"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Your keys usage"/);
    expect(src).toMatch(/Choose your team/);
  });
});
