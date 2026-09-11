import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Driver Tryouts last snapshot stays on the phone", () => {
  it("reads and writes the driver-tryouts IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "driver-tryouts-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"driver-tryouts"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Driver Tryouts"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/!view/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
