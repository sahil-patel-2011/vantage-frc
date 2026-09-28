import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyLoadFailure } from "../../lib/ui/load-failure";

const DIR = __dirname;

describe("Team admin last snapshot stays on the phone", () => {
  it("reads and writes the team-admin IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "team-admin-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/clearFeatureSnapshot/);
    expect(src).toMatch(/"team-admin"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).toMatch(/feature="Team admin"/);
    expect(src).toMatch(/classifyLoadFailure/);
    expect(src).toMatch(/\["auth", "reauth", "forbidden"\]\.includes/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
  it("clears cached admin data for auth and role denials, including legacy 400 responses", () => {
    expect(classifyLoadFailure({ status: 401 })).toBe("auth");
    expect(classifyLoadFailure({ status: 403 })).toBe("forbidden");
    expect(classifyLoadFailure({ status: 400, message: "Access denied" })).toBe("forbidden");
    expect(classifyLoadFailure({ status: 403, message: "Sign in again with your authenticator-app" })).toBe("reauth");
  });
});
