import { describe, expect, it } from "vitest";
import { nextOnboardingStep, previousOnboardingStep, skipsTeamStep } from "./step-model";

describe("an invited member skips the team screen", () => {
  it("goes You, then Finish, and Back returns to You", () => {
    const invited = { locked: true, isTeamHead: false };
    expect(skipsTeamStep(invited)).toBe(true);
    expect(nextOnboardingStep("profile", invited)).toBe("preferences");
    expect(previousOnboardingStep("preferences", invited)).toBe("profile");
  });

  it("keeps the team screen for whoever runs the team, and for someone not invited", () => {
    expect(nextOnboardingStep("profile", { locked: true, isTeamHead: true })).toBe("team");
    expect(nextOnboardingStep("profile", { locked: false, isTeamHead: false })).toBe("team");
    expect(nextOnboardingStep("profile")).toBe("team");
  });
});
