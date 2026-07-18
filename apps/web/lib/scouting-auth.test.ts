import { describe, expect, it } from "vitest";
import { isWrongOrgDenied, ScoutingHttpError, scoutingErrorResponse } from "./scouting-auth";

describe("scouting auth — wrong orgId denied", () => {
  it("treats missing membership as a hard deny", () => {
    expect(isWrongOrgDenied(0)).toBe(true);
    expect(isWrongOrgDenied(1)).toBe(false);
  });

  it("maps ScoutingHttpError 403 for Organization access denied", async () => {
    const response = scoutingErrorResponse(new ScoutingHttpError(403, "Organization access denied"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Organization access denied" });
  });

  it("maps legacy Error('Organization access denied') strings to 403", () => {
    expect(scoutingErrorResponse(new Error("Organization access denied")).status).toBe(403);
  });

  it("keeps validation failures as 400", () => {
    expect(scoutingErrorResponse(new Error("Invalid media metadata")).status).toBe(400);
  });
});
