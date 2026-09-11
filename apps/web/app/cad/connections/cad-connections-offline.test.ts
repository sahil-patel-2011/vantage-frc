import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("CAD connections last snapshot stays on the phone", () => {
  it("reads and writes the cad-connections IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "connections-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"cad-connections"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="CAD connections"/);
  });
});
