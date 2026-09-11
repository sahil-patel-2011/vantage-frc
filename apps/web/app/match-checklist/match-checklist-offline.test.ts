import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Match checklist last snapshot stays on the phone", () => {
  it("reads and writes the match-checklist IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "match-checklist-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"match-checklist"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Match checklist"/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).toMatch(/urlOrg \|\| "_"/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
    expect(src).not.toMatch(/\{fetchFailed \?/);
  });
});
