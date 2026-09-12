import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Team setup last snapshot stays on the phone", () => {
  it("reads and writes the getting-started IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "getting-started-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"getting-started"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Team setup"/);
  });
});
