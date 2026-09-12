import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Pick list last snapshot stays on the phone", () => {
  it("reads and writes the picklist-collab IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "picklist-collab-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"picklist-collab"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Pick list"/);
  });
});
