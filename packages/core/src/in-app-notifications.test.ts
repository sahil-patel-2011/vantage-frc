import { describe, expect, it } from "vitest";
import {
  DEFAULT_IN_APP_NOTIFICATION_PREFS,
  mergeInAppNotificationPrefs,
  prefKeyForNotificationType,
} from "./in-app-notifications";

describe("in-app notification prefs", () => {
  it("defaults team-ops alerts on and product notes off", () => {
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.todoAssigned).toBe(true);
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.dutyAssigned).toBe(true);
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.calendarEvents).toBe(true);
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.sponsorReminders).toBe(true);
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.productUpdates).toBe(false);
  });

  it("merges partial prefs without dropping unknowns as false", () => {
    expect(mergeInAppNotificationPrefs({ todoAssigned: false, productUpdates: true })).toEqual({
      ...DEFAULT_IN_APP_NOTIFICATION_PREFS,
      todoAssigned: false,
      productUpdates: true,
    });
    expect(mergeInAppNotificationPrefs(null)).toEqual(DEFAULT_IN_APP_NOTIFICATION_PREFS);
    expect(mergeInAppNotificationPrefs("nope")).toEqual(DEFAULT_IN_APP_NOTIFICATION_PREFS);
  });

  it("maps notification types to preference keys", () => {
    expect(prefKeyForNotificationType("todo_assigned")).toBe("todoAssigned");
    expect(prefKeyForNotificationType("todo_completed")).toBe("todoCompleted");
    expect(prefKeyForNotificationType("duty_assigned")).toBe("dutyAssigned");
    expect(prefKeyForNotificationType("calendar_event")).toBe("calendarEvents");
    expect(prefKeyForNotificationType("calendar_updated")).toBe("calendarEvents");
    expect(prefKeyForNotificationType("scout_reminder")).toBe("scoutReminders");
    expect(prefKeyForNotificationType("scouting_coverage_gap")).toBe("scoutReminders");
    expect(prefKeyForNotificationType("sponsor_thank_you_due")).toBe("sponsorReminders");
    expect(prefKeyForNotificationType("sponsor_renewal_due")).toBe("sponsorReminders");
    expect(prefKeyForNotificationType("sponsor_followup_overdue")).toBe("sponsorReminders");
    expect(prefKeyForNotificationType("direct_message")).toBeNull();
  });
});
