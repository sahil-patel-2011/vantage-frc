import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Team security last snapshot stays on the phone", () => {
  it("hub access reads and writes the hub-access IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "hub-access-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"hub-access"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Team security"/);
  });

  it("capabilities reads and writes the member-capabilities IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "capabilities-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"member-capabilities"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Team security"/);
    expect(src).not.toMatch(/API keys/);
  });

  it("sign-in policy reads and writes the auth-policy IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "policy-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"auth-policy"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Team security"/);
    expect(src).not.toMatch(/>API keys</);
  });

  it("no-org setup says Choose your team, not pick the team first", () => {
    const src = readFileSync(join(DIR, "page.tsx"), "utf8");
    expect(src).toMatch(/Choose your team/);
    expect(src).not.toMatch(/pick the team first/i);
  });
});
