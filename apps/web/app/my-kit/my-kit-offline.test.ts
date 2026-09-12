import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("My kit last snapshot stays on the phone", () => {
  it("reads and writes the my-kit IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "my-kit-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"my-kit"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="My kit"/);
  });
});
