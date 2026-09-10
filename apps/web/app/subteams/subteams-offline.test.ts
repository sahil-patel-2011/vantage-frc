import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Subteam progress last snapshot stays on the phone", () => {
  it("reads and writes the subteams IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "subteams-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"subteams"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Subteam progress"/);
  });
});
