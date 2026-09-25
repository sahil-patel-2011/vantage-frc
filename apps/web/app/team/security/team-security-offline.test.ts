import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Team security last snapshot stays on the phone", () => {
  it("points to Team admin Access instead of repeating the member list", () => {
    const src = readFileSync(join(DIR, "policy-client.tsx"), "utf8");
    expect(src).toMatch(/Who can open what/);
    expect(src).toMatch(/#people/);
    const page = readFileSync(join(DIR, "page.tsx"), "utf8");
    expect(page).not.toMatch(/HubAccessClient|CapabilitiesClient/);
  });

  it("sign-in policy reads and writes the auth-policy IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "policy-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"auth-policy"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Team security"/);
    expect(src).not.toMatch(/>API keys</);
    // The shared Team settings row, for the people who can open those pages.
    expect(src).toMatch(/canManage \? <TeamSettingsNav orgId=\{orgId\} current="security" \/>/);
    expect(src).toMatch(/Owners and admins set sign-in methods/);
    expect(src).toMatch(/canEditPolicy/);
  });

  it("no-org setup says Choose your team, not pick the team first", () => {
    const src = readFileSync(join(DIR, "page.tsx"), "utf8");
    expect(src).toMatch(/Choose your team/);
    expect(src).not.toMatch(/pick the team first/i);
  });
});
