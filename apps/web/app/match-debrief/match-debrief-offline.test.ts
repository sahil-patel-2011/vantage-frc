import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Match debrief last snapshot stays on the phone", () => {
  it("reads and writes the match-debrief IndexedDB feature cache", () => {
    const src = [
      readFileSync(join(DIR, "match-debrief-client.tsx"), "utf8"),
      readFileSync(join(DIR, "../api/match-debrief/route.ts"), "utf8"),
    ].join("\n");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"match-debrief"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Match debrief"/);
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
  });
});
