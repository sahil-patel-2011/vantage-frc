import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Recognition last snapshot stays on the phone", () => {
  it("reads and writes the recognition IndexedDB feature cache", () => {
    const src = [
      readFileSync(join(DIR, "recognition-client.tsx"), "utf8"),
      readFileSync(join(DIR, "../api/recognition/route.ts"), "utf8"),
    ].join("\n");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"recognition"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Recognition"/);
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
    expect(src).toContain("Choose your team to run team awards, or join the waitlist.");
    expect(src).toContain("Choose your team to run team awards.");
  });
});
