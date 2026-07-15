import { describe, expect, it } from "vitest";
import { validateOnboardingPayload } from "./onboarding";

describe("onboarding validation", () => {
  const base = {
    firstName: "Sahil",
    lastName: "Patel",
    dateOfBirth: "2011-01-15",
    gender: "prefer_not_to_say" as const,
    preferredTeamNumber: 254,
    teamRole: "student" as const,
  };

  it("accepts a complete youth-safe payload", () => {
    const result = validateOnboardingPayload(base);
    expect(result.displayName).toBe("Sahil Patel");
    expect(result.preferredTeamNumber).toBe(254);
  });

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
});
