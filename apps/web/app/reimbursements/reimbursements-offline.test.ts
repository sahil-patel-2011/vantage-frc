import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Reimbursements last snapshot stays on the phone", () => {
  it("reads and writes the reimbursements IndexedDB feature cache", () => {
    const src = [
      readFileSync(join(DIR, "reimbursements-client.tsx"), "utf8"),
      readFileSync(join(DIR, "../api/reimbursements/route.ts"), "utf8"),
    ].join("\n");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"reimbursements"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Reimbursements"/);
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
    expect(src).toContain("Choose your team to file a reimbursement, or join the waitlist.");
    expect(src).toContain("Choose your team to file a reimbursement.");
    expect(src).toContain("Reimbursements are unavailable right now. Confirm database access and try again.");
  });
});
