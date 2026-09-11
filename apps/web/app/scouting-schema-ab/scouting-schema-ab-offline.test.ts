import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Schema A/B last snapshot stays on the phone", () => {
  it("reads and writes the scouting-schema-ab IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "scouting-schema-ab-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"scouting-schema-ab"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Schema A\/B"/);
  });
});
