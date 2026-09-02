import { describe, expect, it } from "vitest";
import {
  DEFAULT_IN_APP_NOTIFICATION_PREFS,
  mergeInAppNotificationPrefs,
  prefKeyForNotificationType,
} from "./in-app-notifications";

describe("in-app notification prefs", () => {
  it("defaults team-ops and product notes on", () => {
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.todoAssigned).toBe(true);
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.dutyAssigned).toBe(true);
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.calendarEvents).toBe(true);
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.sponsorReminders).toBe(true);
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.productUpdates).toBe(true);
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
    expect(prefKeyForNotificationType("scout_shift_assigned")).toBe("scoutReminders");
    expect(prefKeyForNotificationType("sponsor_thank_you_due")).toBe("sponsorReminders");
    expect(prefKeyForNotificationType("sponsor_renewal_due")).toBe("sponsorReminders");
    expect(prefKeyForNotificationType("sponsor_followup_overdue")).toBe("sponsorReminders");
    expect(DEFAULT_IN_APP_NOTIFICATION_PREFS.teamChat).toBe(true);
    expect(prefKeyForNotificationType("team_chat")).toBe("teamChat");
    expect(prefKeyForNotificationType("message_mention")).toBe("teamChat");
  });
});

describe("emitNotificationToOrgMembers query", () => {
  it("is a single INSERT ... SELECT gated by the recipient's preference key", async () => {
    const { buildOrgFanoutQuery } = await import("./in-app-notifications");
    const query = buildOrgFanoutQuery(
      {
        orgId: "org-1",
        type: "team_chat",
        payload: { conversationId: "c1", preview: "hi" },
        excludeUserIds: ["author", "author"],
        onlyUserIds: null,
        conversationId: "c1",
      },
      { viaFunction: true },
    );
    expect(query.text).toMatch(/^INSERT INTO notifications \(user_id, org_id, type, payload\)\s+SELECT/);
    expect(query.text).toContain("org_notification_targets($1::uuid, $6::text, $7::uuid)");
    expect(query.text.match(/INSERT/g)).toHaveLength(1);
    expect(query.values).toEqual([
      "org-1",
      "team_chat",
      JSON.stringify({ conversationId: "c1", preview: "hi" }),
      ["author"],
      null,
      "teamChat",
      "c1",
    ]);
  });

  it("falls back to the memberships/profiles join before migration 0494", async () => {
    const { buildOrgFanoutQuery } = await import("./in-app-notifications");
    const query = buildOrgFanoutQuery(
      { orgId: "org-1", type: "message_mention", onlyUserIds: ["u1", "u2", "u1"] },
      { viaFunction: false },
    );
    expect(query.text).not.toContain("org_notification_targets");
    expect(query.text).toContain("FROM memberships m");
    expect(query.text).toContain("notification_prefs->>$6::text");
    expect(query.values[4]).toEqual(["u1", "u2"]);
    expect(query.values[5]).toBe("teamChat");
  });

  it("passes a null preference key for ungated types", async () => {
    const { buildOrgFanoutQuery } = await import("./in-app-notifications");
    const query = buildOrgFanoutQuery({ orgId: "org-1", type: "team_access_request" }, { viaFunction: true });
    expect(query.values[5]).toBeNull();
  });
});
