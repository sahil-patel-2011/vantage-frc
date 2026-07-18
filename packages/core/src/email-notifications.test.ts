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
  it("defaults every category to opt-out", () => {
    expect(DEFAULT_EMAIL_PREFERENCES).toEqual({
      productUpdates: false,
      coachAssignments: false,
      coachTodos: false,
      coachPracticeReminders: false,
      sponsorReminders: false,
    });
    expect(EMAIL_NOTIFICATION_CATEGORIES).toHaveLength(5);
  });

  it("validates categories and maps preference keys", () => {
    expect(isEmailNotificationCategory("product_updates")).toBe(true);
    expect(isEmailNotificationCategory("sponsor_reminders")).toBe(true);
    expect(isEmailNotificationCategory("spam")).toBe(false);
    expect(preferenceKeyForCategory("coach_todos")).toBe("coachTodos");
    expect(preferenceKeyForCategory("sponsor_reminders")).toBe("sponsorReminders");
    expect(categoryLabel("coach_practice_reminders")).toBe("Practice reminders");
    expect(categoryLabel("sponsor_reminders")).toBe("Sponsor reminders");
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
