import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("What’s new last snapshot stays on the phone", () => {
  it("reads and writes the whats-new IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "whats-new-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"whats-new"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="What’s new"/);
  });
});
