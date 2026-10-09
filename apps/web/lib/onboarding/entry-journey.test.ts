import { describe, expect, it } from "vitest";
import { confirmedOnboardingState, onboardingAnswersKey, onboardingReturnPath, teamJoinInvitePath } from "./entry-journey";

describe("account entry handoffs", () => {
  const fallback = "/dashboard?orgId=team-one";
  it.each(["/onboarding", "/onboarding?next=%2Fonboarding", "/onboarding/", "/%6fnboarding", "/signin?next=%2Fonboarding", "/sign-in", "/access-unavailable", "/%61ccess-unavailable", "//other.example"])("prevents completion returning to %s", next => {
    expect(onboardingReturnPath(next, fallback)).toBe(fallback);
  });
  it("keeps pending invitation and scoped competition destinations", () => {
    expect(onboardingReturnPath("/invite?token=abc", fallback)).toBe("/invite?token=abc");
    expect(onboardingReturnPath("/competition?orgId=team-one&tab=scouting", fallback)).toBe("/competition?orgId=team-one&tab=scouting");
  });
  it("does not restore another member’s or team’s unfinished answers", () => {
    expect(onboardingAnswersKey("one", "team")).not.toBe(onboardingAnswersKey("two", "team"));
    expect(onboardingAnswersKey("one", "team")).not.toBe(onboardingAnswersKey("one", "another-team"));
    expect(onboardingAnswersKey(null, "team")).toBeNull();
    expect(onboardingAnswersKey("one", null)).not.toBe(onboardingAnswersKey("two", null));
  });
  it("requires actual state metadata before advancing or deleting local answers", () => {
    expect(confirmedOnboardingState({ ok: true })).toBe(false);
    expect(confirmedOnboardingState({ complete: true, accessStatus: "approved", currentStep: "complete" })).toBe(true);
    expect(confirmedOnboardingState({ complete: true, accessStatus: "other", currentStep: "complete" })).toBe(false);
  });
  it("accepts only the internal invitation handoff from the join-code endpoint", () => {
    const token = "a".repeat(43);
    expect(teamJoinInvitePath(`/invite?token=${token}`)).toBe(`/invite?token=${token}`);
    for (const href of ["https://other.example", "//other.example", "/dashboard", "/invite?token=", "/invite?token=short", null, {}]) expect(teamJoinInvitePath(href)).toBeNull();
  });
});
