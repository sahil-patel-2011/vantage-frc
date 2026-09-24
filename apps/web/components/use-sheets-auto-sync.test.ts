import { describe, expect, it } from "vitest";
import { isTeamDataWrite } from "./use-sheets-auto-sync";

describe("isTeamDataWrite", () => {
  it("counts saves to team data", () => {
    expect(isTeamDataWrite("POST", "/api/scouting/entries")).toBe(true);
    expect(isTeamDataWrite("patch", "http://localhost:3401/api/todos?orgId=x")).toBe(true);
    expect(isTeamDataWrite("DELETE", "/api/attendance/1")).toBe(true);
  });

  it("ignores reads, sign-in, analytics and its own ping", () => {
    expect(isTeamDataWrite("GET", "/api/scouting/entries")).toBe(false);
    expect(isTeamDataWrite(undefined, "/api/dashboard")).toBe(false);
    expect(isTeamDataWrite("POST", "/api/integrations/sheets/auto")).toBe(false);
    expect(isTeamDataWrite("POST", "/api/auth/sign-in/email-otp")).toBe(false);
    expect(isTeamDataWrite("POST", "/api/analytics/event")).toBe(false);
    expect(isTeamDataWrite("POST", "/api/integrations/mirror/sync")).toBe(false);
  });

  it("ignores anything outside the app's API", () => {
    expect(isTeamDataWrite("POST", "https://example.com/upload")).toBe(false);
    expect(isTeamDataWrite("POST", "/dashboard")).toBe(false);
  });
});
