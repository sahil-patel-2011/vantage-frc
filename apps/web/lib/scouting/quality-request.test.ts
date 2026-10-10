import { describe, expect, it } from "vitest";
import { qualityMeetingDate, qualityPolicyRequest, qualitySeatRequest } from "./quality-request";

describe("quality controls reject ambiguous or impossible input", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-00-01", "2026-2-01", "yesterday"])("rejects an invalid meeting date: %s", value => {
    expect(qualityMeetingDate.safeParse(value).success).toBe(false);
  });
  it("accepts a leap day only in a leap year", () => {
    expect(qualityMeetingDate.safeParse("2028-02-29").success).toBe(true);
    expect(qualityMeetingDate.safeParse("2026-02-29").success).toBe(false);
  });
  it.each([0, 11, 2.5, "3"])("refuses an invalid seat count: %s", seatCount => {
    expect(qualitySeatRequest.safeParse({ eventKey: "2026txho", meetingOn: "2026-10-09", seatCount }).success).toBe(false);
  });
  it("requires a checking baseline and real booleans", () => {
    const policy = { schemaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fieldKey: "climb", preferredSource: "consensus", enabled: true };
    expect(qualityPolicyRequest.safeParse(policy).success).toBe(false);
    expect(qualityPolicyRequest.safeParse({ ...policy, expectedUpdatedAt: null }).success).toBe(true);
    expect(qualityPolicyRequest.safeParse({ ...policy, expectedUpdatedAt: null, teamIndexed: "false" }).success).toBe(false);
  });
});
