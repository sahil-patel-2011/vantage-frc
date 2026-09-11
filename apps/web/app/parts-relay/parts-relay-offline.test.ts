import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Parts Relay last snapshot stays on the phone", () => {
  it("reads and writes the parts-relay IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "parts-relay-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"parts-relay"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Parts Relay"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
