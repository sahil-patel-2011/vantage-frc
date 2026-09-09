import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_PREFERENCES,
  EMAIL_NOTIFICATION_CATEGORIES,
  buildUnsubscribeUrl,
  categoryLabel,
  isEmailNotificationCategory,
  newUnsubscribeToken,
  preferenceKeyForCategory,
} from "./email-notifications";

describe("email notification preferences", () => {
  it("defaults the opt-out categories on and the coach/sponsor opt-ins off", () => {
    expect(DEFAULT_EMAIL_PREFERENCES).toEqual({
      productUpdates: true,
      coachAssignments: false,
      coachTodos: false,
      coachPracticeReminders: false,
      sponsorReminders: false,
      performanceDigest: true,
      announcements: true,
      duesReminders: true,
      memberOnboarding: true,
    });
    expect(EMAIL_NOTIFICATION_CATEGORIES).toHaveLength(9);
  });

  it("validates categories and maps preference keys", () => {
    expect(isEmailNotificationCategory("product_updates")).toBe(true);
    expect(isEmailNotificationCategory("sponsor_reminders")).toBe(true);
    expect(isEmailNotificationCategory("spam")).toBe(false);
    expect(preferenceKeyForCategory("coach_todos")).toBe("coachTodos");
    expect(preferenceKeyForCategory("sponsor_reminders")).toBe("sponsorReminders");
    expect(isEmailNotificationCategory("performance_digest")).toBe(true);
    expect(preferenceKeyForCategory("performance_digest")).toBe("performanceDigest");
    expect(categoryLabel("coach_practice_reminders")).toBe("Practice reminders");
    expect(categoryLabel("sponsor_reminders")).toBe("Sponsor reminders");
    expect(categoryLabel("performance_digest")).toBe("Daily performance digest");
  });

  /**
   * The three categories the email spine added. Each is its own switch on
   * purpose: a dues reminder folded into `coach_todos` would mean opting out of
   * todos silently opts you out of being told you owe your team money, and
   * wanting the dues notice would force the todos back on.
   */
  it("keeps announcements, dues and onboarding as separate consents", () => {
    for (const category of ["announcements", "dues_reminders", "member_onboarding"] as const) {
      expect(isEmailNotificationCategory(category)).toBe(true);
      // A distinct preference key per category is what makes the switch honest.
      expect(preferenceKeyForCategory(category)).not.toBe("coachTodos");
    }
    expect(preferenceKeyForCategory("announcements")).toBe("announcements");
    expect(preferenceKeyForCategory("dues_reminders")).toBe("duesReminders");
    expect(preferenceKeyForCategory("member_onboarding")).toBe("memberOnboarding");
    expect(categoryLabel("announcements")).toBe("Urgent team announcements");
    expect(categoryLabel("dues_reminders")).toBe("Dues reminders");
    expect(categoryLabel("member_onboarding")).toBe("New member onboarding");

    const keys = EMAIL_NOTIFICATION_CATEGORIES.map((category) => preferenceKeyForCategory(category));
    expect(new Set(keys).size).toBe(EMAIL_NOTIFICATION_CATEGORIES.length);
  });

  it("builds unsubscribe URLs with token and category", () => {
    const token = newUnsubscribeToken();
    expect(token.length).toBeGreaterThanOrEqual(24);
    const url = buildUnsubscribeUrl(token, "product_updates");
    expect(url).toContain("/unsubscribe");
    expect(url).toContain(`token=${encodeURIComponent(token)}`);
    expect(url).toContain("category=product_updates");
  });
});
