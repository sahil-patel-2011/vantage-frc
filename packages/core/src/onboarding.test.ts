import { describe, expect, it } from "vitest";
import { normalizeOrgLocationFields, validateOnboardingPayload } from "./onboarding";

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
  };

  it("accepts a complete youth-safe payload", () => {
    const result = validateOnboardingPayload(base);
    expect(result.displayName).toBe("Sahil Patel");
    expect(result.preferredTeamNumber).toBe(254);
    expect(result.primaryFocus).toBe("build");
  });

  it("requires explicit terms acceptance", () => { expect(() => validateOnboardingPayload({ ...base, termsAccepted: false })).toThrow(/Terms of Service/i); });

  it("rejects future birthdays and invalid team numbers", () => {
    expect(() => validateOnboardingPayload({ ...base, dateOfBirth: "2999-01-01" })).toThrow(/future/i);
    expect(() => validateOnboardingPayload({ ...base, preferredTeamNumber: 0 })).toThrow(/team number/i);
    expect(() => validateOnboardingPayload({ ...base, firstName: "" })).toThrow(/First name/i);
  });

  it("locks display name length", () => {
    expect(() =>
      validateOnboardingPayload({ ...base, displayName: "x".repeat(81) }),
    ).toThrow(/80/);
  });

  it("requires a supported personalization focus", () => {
    expect(() => validateOnboardingPayload({ ...base, primaryFocus: "random" as never })).toThrow(/focus/i);
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
