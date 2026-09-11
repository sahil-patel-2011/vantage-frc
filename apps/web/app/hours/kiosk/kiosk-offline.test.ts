import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Hours kiosk last snapshot stays on the phone", () => {
  it("reads and writes the hours-kiosk IndexedDB feature cache and does not blank a painted board", () => {
    const src = readFileSync(join(DIR, "kiosk-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"hours-kiosk"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Hours kiosk"/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
  });
});
