import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Outreach Calendar last snapshot stays on the phone", () => {
  it("reads and writes the outreach-calendar IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "outreach-calendar-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"outreach-calendar"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Outreach Calendar"/);
  });
});
