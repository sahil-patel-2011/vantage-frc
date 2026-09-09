import { describe, expect, it } from "vitest";
import {
  hasSomethingOutstanding,
  renderOnboardingEmail,
  stageForAge,
  type OnboardingOutstanding,
} from "./compute-onboarding";

const NOTHING: OnboardingOutstanding = {
  profileIncomplete: false,
  openForms: [],
  unacknowledged: [],
};

const SOMETHING: OnboardingOutstanding = {
  profileIncomplete: false,
  openForms: ["Travel & medical form"],
  unacknowledged: [],
};

describe("staging", () => {
  it("moves through the three stages by age", () => {
    expect(stageForAge(0)).toBe("welcome");
    expect(stageForAge(2)).toBe("welcome");
    expect(stageForAge(3)).toBe("first_week");
    expect(stageForAge(9)).toBe("first_week");
    expect(stageForAge(10)).toBe("settling_in");
    expect(stageForAge(30)).toBe("settling_in");
  });

  /**
   * Someone who joined five weeks ago is not a new member. Without this, any
   * backlog sweep would greet long-standing members as if they had just walked
   * in the door.
   */
  it("stops after the window", () => {
    expect(stageForAge(31)).toBeNull();
    expect(stageForAge(400)).toBeNull();
    expect(stageForAge(-1)).toBeNull();
  });
});

describe("what gets written", () => {
  it("always has something honest to say in the welcome", () => {
    const message = renderOnboardingEmail({
      stage: "welcome",
      orgName: "Ridgeview Robotics",
      teamNumber: 4915,
      memberName: "Ana",
      outstanding: NOTHING,
      baseUrl: "https://app.example.com",
    });
    expect(message).not.toBeNull();
    expect(message?.subject).toContain("Team 4915");
    expect(message?.text).toContain("Ana");
    // Consent controls travel with every message, not only the footer the
    // provider appends.
    expect(message?.text).toContain("/notifications/preferences");
  });

  /**
   * The rule that keeps the sequence worth reading. A follow-up with nothing to
   * follow up on is the email that teaches someone to ignore the next one.
   */
  it("sends no follow-up when the member has nothing outstanding", () => {
    expect(
      renderOnboardingEmail({
        stage: "first_week",
        orgName: "Ridgeview Robotics",
        teamNumber: 4915,
        memberName: "Ana",
        outstanding: NOTHING,
        baseUrl: "https://app.example.com",
      }),
    ).toBeNull();
    expect(
      renderOnboardingEmail({
        stage: "settling_in",
        orgName: "Ridgeview Robotics",
        teamNumber: null,
        memberName: null,
        outstanding: NOTHING,
        baseUrl: "https://app.example.com",
      }),
    ).toBeNull();
  });

  it("names the outstanding items rather than counting them vaguely", () => {
    const message = renderOnboardingEmail({
      stage: "first_week",
      orgName: "Ridgeview Robotics",
      teamNumber: 4915,
      memberName: "Ana",
      outstanding: SOMETHING,
      baseUrl: "https://app.example.com/",
    });
    expect(message?.text).toContain("Travel & medical form");
    expect(message?.text).toContain("https://app.example.com/forms");
    // Trailing slash on the base URL must not produce a doubled one.
    expect(message?.text).not.toContain("com//");
  });

  it("counts an incomplete profile and an unacknowledged notice as outstanding", () => {
    expect(hasSomethingOutstanding(NOTHING)).toBe(false);
    expect(hasSomethingOutstanding({ ...NOTHING, profileIncomplete: true })).toBe(true);
    expect(hasSomethingOutstanding({ ...NOTHING, unacknowledged: ["Bus leaves at 6:15"] })).toBe(true);
  });

  it("says the last nudge is the last one", () => {
    const message = renderOnboardingEmail({
      stage: "settling_in",
      orgName: "Ridgeview Robotics",
      teamNumber: 4915,
      memberName: "Ana",
      outstanding: SOMETHING,
      baseUrl: "https://app.example.com",
    });
    expect(message?.text).toMatch(/last automatic reminder/i);
  });
});
