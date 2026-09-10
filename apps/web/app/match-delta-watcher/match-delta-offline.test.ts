import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Match-delta watcher last snapshot stays on the phone", () => {
  it("reads and writes the match-delta IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "match-delta-watcher-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"match-delta"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Match-delta watcher"/);
  });
});
