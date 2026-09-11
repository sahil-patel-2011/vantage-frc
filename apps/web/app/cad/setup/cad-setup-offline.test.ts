import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("CAD setup last snapshot stays on the phone", () => {
  it("reads and writes the cad-setup IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "setup-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"cad-setup"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="CAD setup"/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).toMatch(/clearFeatureSnapshot/);
    expect(src).toMatch(/Choose your team/);
            expect(src).toMatch(/OnshapeEditBoard/);
    expect(src).toMatch(/FusionEditBoard/);
    expect(src).toMatch(/Needs setup/);
  });
});
