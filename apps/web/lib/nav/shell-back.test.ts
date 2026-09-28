import { describe, expect, it } from "vitest";
import { shellBackUsesHistory } from "./shell-back";
describe("shell Back destinations", () => {
  it("returns to the actual filtered robot list instead of constructing a parent URL", () => {
    expect(shellBackUsesHistory("https://vantage.test/teams/254?orgId=a", "https://vantage.test/competition?tab=teams&orgId=a&event=2026test&team=254")).toBe(true);
  });
  it("does not return to another team, external site or sign-in", () => {
    const current = "https://vantage.test/notifications?orgId=a";
    expect(shellBackUsesHistory(current,"https://vantage.test/dashboard?orgId=b")).toBe(false);
    expect(shellBackUsesHistory(current,"https://external.test/dashboard?orgId=a")).toBe(false);
    expect(shellBackUsesHistory(current,"https://vantage.test/signin")).toBe(false);
  });
  it("uses observed app steps on browsers without Navigation API, with a safe direct-entry fallback", () => {
    expect(shellBackUsesHistory("https://vantage.test/notifications",null,1)).toBe(true);
    expect(shellBackUsesHistory("https://vantage.test/notifications",null,0)).toBe(false);
  });
});
