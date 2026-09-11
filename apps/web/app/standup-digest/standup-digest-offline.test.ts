import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Morning standup last snapshot stays on the phone", () => {
  it("reads and writes the standup-digest IndexedDB feature cache and does not blank a painted board", () => {
    const src = readFileSync(join(DIR, "standup-digest-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"standup-digest"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Morning standup"/);
    expect(src).toMatch(/orgHint \|\| "_"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
