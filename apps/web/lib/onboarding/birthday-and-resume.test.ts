/**
 * QA A1-01, A1-16, A1-17, A1-20: a refused birthday is caught before the server (so the message
 * sits beside the field, not at the top of the card), server refusals go back to the field that
 * can fix them, a reload reopens the same screen the person was on, and a role default is not
 * mistaken for an answer.
 */
import { describe, expect, it } from "vitest";
import { buildOnboardingStepMeta, onboardingProgressLabel } from "./onboarding-flow";
import {
  ageOnDate,
  birthDateProblem,
  emptyOnboardingDraft,
  onboardingAdvance,
  onboardingErrorTarget,
  resumeOnboardingStep,
  resumedFocus,
  roleAgeQuestion,
  type OnboardingStepContext,
} from "./step-model";

const NOW = new Date("2026-10-11T12:00:00Z");
const CONTEXT: OnboardingStepContext = { isTeamHead: false, legalNeeded: true, locked: false };

function profile(dateOfBirth: string) {
  return { ...emptyOnboardingDraft(), firstName: "Avery", lastName: "Nguyen", teamRole: "student" as const, dateOfBirth };
}

describe("birthday checks on the first screen", () => {
  it("counts whole years by calendar date, in UTC like the server", () => {
    expect(ageOnDate("2013-10-11", NOW)).toBe(13);
    expect(ageOnDate("2013-10-12", NOW)).toBe(12);
    expect(ageOnDate("2013-02-30", NOW)).toBeNull();
    expect(ageOnDate("10/11/2013", NOW)).toBeNull();
  });

  it("refuses the dates the server refuses, each with a reason a student can act on", () => {
    expect(birthDateProblem("2020-06-01", NOW)).toMatch(/13 and older/);
    expect(birthDateProblem("2026-10-11", NOW)).toMatch(/13 and older/); // today
    expect(birthDateProblem("2035-05-05", NOW)).toMatch(/can't be in the future/);
    expect(birthDateProblem("0001-01-01", NOW)).toMatch(/Check the year/);
    expect(birthDateProblem("1900-01-01", NOW)).toMatch(/Check the year/);
    expect(birthDateProblem("2009-02-30", NOW)).toMatch(/doesn't exist/);
    expect(birthDateProblem("", NOW)).toMatch(/Add your date of birth/);
    expect(birthDateProblem("2013-10-11", NOW)).toBeNull(); // thirteenth birthday
    expect(birthDateProblem("1975-03-03", NOW)).toBeNull();
  });

  it("stops Continue on the date field instead of sending a date the server will refuse", () => {
    for (const dob of ["2020-06-01", "2035-05-05", "0001-01-01", "1900-01-01"]) {
      const result = onboardingAdvance({ step: "profile", draft: profile(dob), error: null, errorField: null }, CONTEXT, NOW);
      expect(result.step, dob).toBe("profile");
      expect(result.errorField, dob).toBe("dateOfBirth");
      expect(result.error, dob).toBeTruthy();
    }
    const ok = onboardingAdvance({ step: "profile", draft: profile("2010-01-01"), error: null, errorField: null }, CONTEXT, NOW);
    expect(ok.error).toBeNull();
    expect(ok.step).toBe("team");
  });
});

describe("a role and a birthday that rarely go together", () => {
  it("asks an under-18 mentor, coach or parent, and a student of 25 or more", () => {
    expect(roleAgeQuestion("mentor", "2011-01-01", NOW)).toMatch(/Mentor.*15.*Is that right/);
    expect(roleAgeQuestion("coach", "2011-01-01", NOW)).toMatch(/Head mentor or coach/);
    expect(roleAgeQuestion("parent", "2011-01-01", NOW)).toMatch(/Parent/);
    expect(roleAgeQuestion("student", "1975-03-03", NOW)).toMatch(/Student.*51/);
  });

  it("leaves the usual cases alone", () => {
    expect(roleAgeQuestion("student", "2010-01-01", NOW)).toBeNull();
    expect(roleAgeQuestion("mentor", "1990-01-01", NOW)).toBeNull();
    expect(roleAgeQuestion("student", "2003-01-01", NOW)).toBeNull(); // 23: college-age alumni help out
    expect(roleAgeQuestion("other", "2012-01-01", NOW)).toBeNull();
    expect(roleAgeQuestion("", "1975-03-03", NOW)).toBeNull();
    expect(roleAgeQuestion("mentor", "", NOW)).toBeNull();
  });
});

describe("a server refusal goes to the field that can fix it", () => {
  it("routes the server's own sentences", () => {
    expect(onboardingErrorTarget("Vantage accounts are available to people age 13 and older.")).toEqual({ step: "profile", field: "dateOfBirth" });
    expect(onboardingErrorTarget("Date of birth cannot be in the future.")).toEqual({ step: "profile", field: "dateOfBirth" });
    expect(onboardingErrorTarget("First name is required (max 60 characters).")).toEqual({ step: "profile", field: "firstName" });
    expect(onboardingErrorTarget("Select a valid team role.")).toEqual({ step: "profile", field: "teamRole" });
    expect(onboardingErrorTarget("Select whether your team is a private school, public school, or community team.")).toEqual({ step: "team", field: "teamAffiliation" });
    // The funding question's error slot is "funding" (onboarding-funding.tsx); "fundingModel" showed nothing.
    expect(onboardingErrorTarget("Select at least one funding path: school funds, outside grants, or sponsors.")).toEqual({ step: "team", field: "funding" });
  });

  it("leaves a lost connection or a server fault above the buttons", () => {
    expect(onboardingErrorTarget("Could not save onboarding progress.")).toBeNull();
    expect(onboardingErrorTarget("Too many onboarding changes. Wait a moment and try again.")).toBeNull();
  });
});

describe("a reload reopens the screen the person was on", () => {
  const invited = { locked: true, isTeamHead: false };
  it("skips the team screen after a reload too, for someone the invite put on a team", () => {
    // The server's saved step is "team" after the profile PATCH, a screen they never saw.
    expect(resumeOnboardingStep("team", invited)).toBe("preferences");
    expect(resumeOnboardingStep("team", { locked: true, isTeamHead: true })).toBe("team");
    expect(resumeOnboardingStep("team", { locked: false, isTeamHead: false })).toBe("team");
    expect(resumeOnboardingStep("preferences", invited)).toBe("preferences");
    expect(resumeOnboardingStep("profile", invited)).toBe("profile");
    expect(resumeOnboardingStep(null, invited)).toBe("profile");
  });

  it("numbers the steps they actually see", () => {
    expect(onboardingProgressLabel("preferences", { skipTeam: true })).toBe("Step 2 of 2 · Finish");
    expect(buildOnboardingStepMeta("preferences", { skipTeam: true }).map((item) => item.label)).toEqual(["You", "Finish"]);
    expect(onboardingProgressLabel("preferences")).toBe("Step 3 of 3 · Finish");
  });
});

describe("the starting view after a reload", () => {
  it("uses the role's default until the team screen has been saved", () => {
    // The server says "competition" for a focus nobody picked (the column default).
    expect(resumedFocus({ serverFocus: "competition", serverStep: "team", teamRole: "parent", crewRole: "" })).toEqual({ focus: "leadership", answered: false });
    expect(resumedFocus({ serverFocus: "competition", serverStep: "profile", teamRole: "student", crewRole: "programming" })).toEqual({ focus: "build", answered: false });
  });

  it("keeps a focus the person saved", () => {
    expect(resumedFocus({ serverFocus: "competition", serverStep: "preferences", teamRole: "parent", crewRole: "" })).toEqual({ focus: "competition", answered: true });
    expect(resumedFocus({ serverFocus: "business", serverStep: "complete", teamRole: "mentor", crewRole: "" })).toEqual({ focus: "business", answered: true });
  });
});
