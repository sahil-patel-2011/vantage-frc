import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Schema sync last snapshot stays on the phone", () => {
  it("reads and writes the scout-schema-negotiate IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "scout-schema-negotiate-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"scout-schema-negotiate"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Schema sync"/);
  });
});
