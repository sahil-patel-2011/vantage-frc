import { describe, expect, it } from "vitest";
import {
  isPayingOrgEntitlement,
  paidSplashStorageKey,
  shouldShowPaidSessionSplash,
} from "./paid-plan";

describe("isPayingOrgEntitlement", () => {
  it("treats free / missing / inactive as unpaid", () => {
    expect(isPayingOrgEntitlement({ planCode: "free", status: "active" })).toBe(false);
    expect(isPayingOrgEntitlement({ planCode: null, status: "active" })).toBe(false);
    expect(isPayingOrgEntitlement({ planCode: "team_pro", status: "expired" })).toBe(false);
    expect(isPayingOrgEntitlement({ planCode: "team_pro", status: "revoked" })).toBe(false);
  });

  it("accepts paid and trial entitlements while active", () => {
    expect(isPayingOrgEntitlement({ planCode: "access", status: "active" })).toBe(true);
    expect(isPayingOrgEntitlement({ planCode: "team_pro", status: "active" })).toBe(true);
    expect(isPayingOrgEntitlement({ planCode: "individual_max", status: "trialing" })).toBe(true);
    expect(isPayingOrgEntitlement({ planCode: "team_trial", status: "active" })).toBe(true);
  });
});

describe("shouldShowPaidSessionSplash", () => {
  it("requires paid org, team number, org id, and first show in session", () => {
    expect(
      shouldShowPaidSessionSplash({
        paidOrg: true,
        teamNumber: 254,
        orgId: "org-1",
        alreadyShown: false,
      }),
    ).toBe(true);
    expect(
      shouldShowPaidSessionSplash({
        paidOrg: false,
        teamNumber: 254,
        orgId: "org-1",
        alreadyShown: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPaidSessionSplash({
        paidOrg: true,
        teamNumber: null,
        orgId: "org-1",
        alreadyShown: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPaidSessionSplash({
        paidOrg: true,
        teamNumber: 254,
        orgId: "org-1",
        alreadyShown: true,
      }),
    ).toBe(false);
  });

  it("scopes session storage per org", () => {
    expect(paidSplashStorageKey("abc")).toBe("vantage.paidSplash.v1:abc");
  });
});
