import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("My Hours last snapshot stays on the phone", () => {
  it("reads and writes the hours-self-view IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "hours-self-view-client.tsx"), "utf8");
    const compute = readFileSync(join(DIR, "../../lib/hours-self-view/compute-hours-self-view.ts"), "utf8");
    expect(src).toMatch(/href="\/#waitlist"/);
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
    expect(compute).toContain("Choose your team to view your own hours, or join the waitlist.");
    expect(compute).toContain("Choose your team to view your own hours.");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"hours-self-view"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="My Hours"/);
  });
});
