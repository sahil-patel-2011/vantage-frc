import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Subsystem sign-off last snapshot stays on the phone", () => {
  it("reads and writes the subsystem-signoff IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "subsystem-signoff-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"subsystem-signoff"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Subsystem sign-off"/);
  });
});
