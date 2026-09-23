import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Forms and consent offers the waitlist when no team is open", () => {
  it("names the waitlist only in the no-membership sentence", () => {
    const src = [
      readFileSync(join(DIR, "consent-client.tsx"), "utf8"),
      readFileSync(join(DIR, "../api/consent/route.ts"), "utf8"),
    ].join("\n");
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
    expect(src).toContain("Choose your team to track forms, or join the waitlist.");
    expect(src).toContain("Choose your team to track forms.");
  });
});
