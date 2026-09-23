import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Inspection last snapshot stays on the phone", () => {
  it("reads and writes the inspection IndexedDB feature cache", () => {
    const src = [
      readFileSync(join(DIR, "inspection-client.tsx"), "utf8"),
      readFileSync(join(DIR, "../api/inspection/route.ts"), "utf8"),
    ].join("\n");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"inspection"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Inspection"/);
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
