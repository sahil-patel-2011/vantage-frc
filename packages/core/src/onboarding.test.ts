import { describe, expect, it } from "vitest";
import {
  isMissingWorkspaceError,
  normalizeOrgLocationFields,
  parsePreferredTeamNumber,
  validateOnboardingPayload,
} from "./onboarding";

describe("onboarding validation", () => {
  const base = {
    firstName: "Sahil",
    lastName: "Patel",
    dateOfBirth: "2011-01-15",
    gender: "prefer_not_to_say" as const,
    preferredTeamNumber: 254,
    teamRole: "student" as const,
    primaryFocus: "build" as const,
    termsAccepted: true,
    privacyAccepted: true,
  };

  it("accepts a complete youth-safe payload", () => {
    const result = validateOnboardingPayload(base);
    expect(result.displayName).toBe("Sahil Patel");
    expect(result.preferredTeamNumber).toBe(254);
    expect(result.primaryFocus).toBe("build");
  });

  it("requires explicit acceptance of BOTH documents", () => {
    expect(() => validateOnboardingPayload({ ...base, termsAccepted: false })).toThrow(/Terms of Service/i);
    expect(() => validateOnboardingPayload({ ...base, privacyAccepted: false })).toThrow(/Privacy Policy/i);
    expect(() => validateOnboardingPayload({ ...base, termsAccepted: false, privacyAccepted: false })).toThrow(
      /Terms of Service and to the Privacy Policy/i,
    );
  });

  it("rejects future birthdays and invalid team numbers", () => {
    expect(() => validateOnboardingPayload({ ...base, dateOfBirth: "2999-01-01" })).toThrow(/future/i);
    expect(() => validateOnboardingPayload({ ...base, preferredTeamNumber: 0 })).toThrow(/team number/i);
    expect(() => validateOnboardingPayload({ ...base, firstName: "" })).toThrow(/First name/i);
  });

  it("allows finishing without a team number", () => {
    const result = validateOnboardingPayload({ ...base, preferredTeamNumber: null });
    expect(result.preferredTeamNumber).toBeNull();
    expect(parsePreferredTeamNumber("")).toBeNull();
    expect(parsePreferredTeamNumber(null)).toBeNull();
  });

  it("stores crew role and a short role description", () => {
    const result = validateOnboardingPayload({
      ...base,
      crewRole: "cad",
      roleDescription: "CAD lead for the elevator",
    });
    expect(result.crewRole).toBe("cad");
    expect(result.roleDescription).toBe("CAD lead for the elevator");
    expect(() =>
      validateOnboardingPayload({ ...base, roleDescription: "x".repeat(281) }),
    ).toThrow(/280/);
  });

  it("treats a missing workspace as a closed-join miss, not a crash", () => {
    expect(isMissingWorkspaceError(new Error("No Vantage workspace exists for FRC team 254 yet."))).toBe(true);
    expect(isMissingWorkspaceError(new Error("Verify your email before requesting team access"))).toBe(false);
  });

  it("locks display name length", () => {
    expect(() =>
      validateOnboardingPayload({ ...base, displayName: "x".repeat(81) }),
    ).toThrow(/80/);
  });

  it("requires a supported personalization focus", () => {
    expect(() => validateOnboardingPayload({ ...base, primaryFocus: "random" as never })).toThrow(/focus/i);
  });

  it("accepts funding fields on complete payloads", () => {
    const result = validateOnboardingPayload({
      ...base,
      teamAffiliation: "private_school",
      schoolFunded: true,
      outsideGrants: false,
      sponsorsAllowed: false,
    });
    expect(result.teamAffiliation).toBe("private_school");
    expect(result.schoolFunded).toBe(true);
    expect(result.sponsorsAllowed).toBe(false);
  });

  it("rejects unknown team affiliation", () => {
    expect(() =>
      validateOnboardingPayload({ ...base, teamAffiliation: "homeschool" as never }),
    ).toThrow(/private school|public school|community/i);
  });
});

describe("normalizeOrgLocationFields", () => {
  it("requires city and state when team head", () => {
    expect(() => normalizeOrgLocationFields({}, { requireLocation: true })).toThrow(/City/i);
    expect(() => normalizeOrgLocationFields({ city: "Austin" }, { requireLocation: true })).toThrow(/State/i);
    const ok = normalizeOrgLocationFields({ city: "Austin", stateProv: "TX", description: "  " }, { requireLocation: true });
    expect(ok).toEqual({ city: "Austin", stateProv: "TX", description: null });
  });

  it("allows empty location when not required", () => {
    expect(normalizeOrgLocationFields({}, { requireLocation: false })).toEqual({
      city: null,
      stateProv: null,
      description: null,
    });
  });
});
