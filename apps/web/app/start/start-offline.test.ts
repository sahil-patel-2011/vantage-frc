import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Your path last snapshot stays on the phone", () => {
  it("reads and writes the start IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "start-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"start"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Your path"/);
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/join the waitlist/i);
    expect(src).toContain('href="/workspace"');
    expect(src).toContain('title="Choose your team"');
  });

  it("tells a person with no team to join the waitlist", () => {
    const compute = readFileSync(join(DIR, "../../lib/role-onboarding/compute.ts"), "utf8");
    expect(compute).toMatch(/Choose your team to open your onboarding path, or join the waitlist/);
  });
});
