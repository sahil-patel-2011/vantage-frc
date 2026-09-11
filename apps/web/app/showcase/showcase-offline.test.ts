import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Showcase last snapshot stays on the phone", () => {
  it("reads and writes the showcase IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "showcase-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"showcase"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Showcase"/);
    expect(src).not.toMatch(/VANTAGE \//);
    expect(src).not.toMatch(/does not invent/);
  });
});
