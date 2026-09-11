import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("CAD Learn last snapshot stays on the phone", () => {
  it("reads and writes the cad-learn IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "cad-learn-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"cad-learn"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="CAD Learn"/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).toMatch(/clearFeatureSnapshot/);
    expect(src).toMatch(/authBlocked/);
    expect(src).toMatch(/OnshapeEditBoard/);
  });

  it("keeps related in the header and does not stack Vantage sibling CTAs in Stuck", () => {
    const src = readFileSync(join(DIR, "cad-learn-client.tsx"), "utf8");
    expect(src).toMatch(/CadLearnHeader/);
    expect(src).toMatch(/CadLearnNextActions/);
    expect(src).not.toMatch(/The CAD workbench/);
    expect(src).not.toMatch(/Programming subteam\? Start here instead/);
    expect(src).not.toMatch(/\bMOI\b/);
  });
});
