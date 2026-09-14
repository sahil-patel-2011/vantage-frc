import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Day plan last snapshot stays on the phone", () => {
  it("reads and writes the event-day-plan IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "event-day-plan-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"event-day-plan"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Day plan"/);
  });
});
