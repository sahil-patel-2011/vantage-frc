import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Season roles last snapshot stays on the phone", () => {
  it("reads and writes the roles IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "roles-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"roles"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Season roles"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
