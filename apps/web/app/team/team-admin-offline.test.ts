import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Team admin last snapshot stays on the phone", () => {
  it("reads and writes the team-admin IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "team-admin-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/clearFeatureSnapshot/);
    expect(src).toMatch(/"team-admin"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).toMatch(/feature="Team admin"/);
    expect(src).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
