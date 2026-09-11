import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Alumni last snapshot stays on the phone", () => {
  it("reads and writes the alumni IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "alumni-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"alumni"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Alumni"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/snapshotRef/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
