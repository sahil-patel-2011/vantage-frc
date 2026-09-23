import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Safety last snapshot stays on the phone", () => {
  it("reads and writes the safety IndexedDB feature cache and does not blank a painted board", () => {
    const src = [
      readFileSync(join(DIR, "safety-client.tsx"), "utf8"),
      readFileSync(join(DIR, "../api/safety/route.ts"), "utf8"),
    ].join("\n");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"safety"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Safety"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(src).toMatch(/orgHint \|\| "_"/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
    expect(src).toContain("Choose your team to track safety, or join the waitlist.");
    expect(src).toContain("Choose your team to track safety.");
  });
});
