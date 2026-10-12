import { describe, expect, it } from "vitest";
import { buildOnboardingStepMeta } from "./onboarding-flow";
import {
  emptyOnboardingDraft,
  firstMissingAnswer,
  missingAnswersBefore,
  onboardingAdvance,
  onboardingStepComplete,
  type OnboardingDraft,
  type OnboardingStepContext,
} from "./step-model";

const NOW = new Date("2026-10-12T12:00:00Z");

function profile(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    ...emptyOnboardingDraft(),
    firstName: "Sam",
    lastName: "Lee",
    dateOfBirth: "2010-03-04",
    gender: "prefer_not_to_say",
    teamRole: "student",
    teamNumber: "6925",
    termsAccepted: true,
    privacyAccepted: true,
    ...overrides,
  };
}

/** The owner the platform set a team up for: locked to it, and the funding questions are theirs. */
const OWNER: OnboardingStepContext = {
  isTeamHead: true,
  legalNeeded: true,
  locked: true,
  lockedTeamNumber: 6925,
  lockedOrgName: "Team 6925",
  accessStatus: "approved",
  knownTeamNumber: 6925,
};

describe("Finish checks every screen before it", () => {
  it("sends an owner who reopened on Finish back to the team screen for funding", () => {
    const draft = profile();
    const result = onboardingAdvance({ step: "preferences", draft, error: null, errorField: null }, OWNER, NOW);
    expect(result.submit).toBe(false);
    expect(result.step).toBe("team");
    expect(result.errorField).toBe("teamAffiliation");
    expect(result.error).toMatch(/affiliated/i);
    expect(result.draft).toBe(draft);
  });

  it("submits once every screen is answered", () => {
    const draft = profile({ teamAffiliation: "public_school", fundingModel: "self_funded" });
    const result = onboardingAdvance({ step: "preferences", draft, error: null, errorField: null }, OWNER, NOW);
    expect(result).toMatchObject({ submit: true, error: null, step: "preferences" });
  });

  it("lists what earlier screens still need, first screen first", () => {
    const gaps = missingAnswersBefore("preferences", profile({ lastName: "" }), OWNER, NOW);
    expect(gaps.map((gap) => [gap.step, gap.field])).toEqual([
      ["profile", "lastName"],
      ["team", "teamAffiliation"],
    ]);
    expect(firstMissingAnswer("preferences", profile({ lastName: "" }), OWNER, NOW)?.field).toBe("lastName");
  });

  it("skips the team screen for an invited member who never sees it", () => {
    const member: OnboardingStepContext = { ...OWNER, isTeamHead: false };
    expect(missingAnswersBefore("preferences", profile(), member, NOW)).toEqual([]);
    expect(onboardingStepComplete("team", profile(), member, NOW)).toBe(true);
  });
});

describe("progress marks", () => {
  it("only marks an earlier screen done when its answers are all there", () => {
    const draft = profile();
    const meta = buildOnboardingStepMeta("preferences", {
      complete: (id) => onboardingStepComplete(id, draft, OWNER, NOW),
    });
    expect(meta.map((item) => item.phase)).toEqual(["done", "missing", "current"]);
  });

  it("keeps the old marks when no check is given", () => {
    expect(buildOnboardingStepMeta("preferences").map((item) => item.phase)).toEqual(["done", "done", "current"]);
  });
});
