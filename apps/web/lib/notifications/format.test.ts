import { describe, expect, it } from "vitest";
import { notificationBody, notificationHref, notificationTitle, notificationTypeLabel } from "./format";

describe("notification helpers", () => {
  it("prefers payload title and body", () => {
    expect(notificationTitle("export_ready", { title: "Team export ready" })).toBe("Team export ready");
    expect(notificationBody({ body: "Available for 24 hours." })).toBe("Available for 24 hours.");
  });

  it("humanizes type when payload has no title", () => {
    expect(notificationTitle("credit_low")).toBe("AI limits");
    expect(notificationTypeLabel("todo_assigned")).toBe("Todo");
    expect(notificationTypeLabel("unknown_kind")).toBe("Unknown Kind");
    expect(notificationBody({})).toBeNull();
  });

  it("files team lifecycle notes under Team", () => {
    for (const type of ["member_left", "team_deleted", "team_owner_added"]) {
      expect(notificationTypeLabel(type)).toBe("Team");
    }
    expect(notificationHref("team_deleted", { href: "/account/teams" }, null)).toBe("/account/teams");
  });

  it("files your own access changes and invite suggestions under Team (QA A3-04, A3-16)", () => {
    for (const type of ["team_role_changed", "team_removed", "team_ownership_given", "invite_suggestion", "team_access_request"]) {
      expect(notificationTypeLabel(type)).toBe("Team");
    }
  });

  it("turns a student's suggestion into a one-tap invite for the owner (QA A3-04)", () => {
    const payload = { fromName: "Sam Student", email: "lee@school.org", suggestedRole: "admin", note: "Teaches CAD" };
    expect(notificationTitle("invite_suggestion", payload)).toBe("Sam Student asks you to invite lee@school.org");
    expect(notificationBody(payload, "invite_suggestion")).toBe('As Mentor or coach. "Teaches CAD" Open Team admin to send the invite.');
    expect(notificationHref("invite_suggestion", payload, "org-1")).toBe(
      "/team/admin?orgId=org-1&invite=1&email=lee%40school.org&role=admin#invite",
    );
  });

  it("sends an asking-to-join notice to Team admin, even for rows that linked to /team (QA A3-17)", () => {
    const legacy = { requesterName: "Dana", teamNumber: 9301, href: "/team#team-access-title" };
    expect(notificationHref("team_access_request", legacy, "org-1")).toBe("/team/admin?orgId=org-1#team-access-title");
    expect(notificationTitle("team_access_request", legacy)).toBe("Dana asked to join Team 9301");
    expect(notificationBody(legacy, "team_access_request")).toMatch(/mentor or coach/);
  });

  it("builds org-scoped hrefs for known types", () => {
    expect(notificationHref("export_ready", {}, "org-1")).toBe("/exports?orgId=org-1");
    expect(notificationHref("dm_message", {}, "org-1")).toBe("/messages?orgId=org-1");
    expect(
      notificationHref("message_mention", { conversationId: "c1" }, "org-1"),
    ).toBe("/messages?orgId=org-1&conversationId=c1");
    expect(notificationHref("todo_assigned", { todoId: "t-1" }, "org-1")).toBe(
      "/todos?orgId=org-1&todoId=t-1",
    );
    expect(notificationHref("todo_completed", {}, "org-1")).toBe("/todos?orgId=org-1");
    expect(notificationHref("duty_assigned", { dutyId: "d-1" }, "org-1")).toBe(
      "/team/calendar?orgId=org-1&dutyId=d-1",
    );
    expect(notificationHref("calendar_event", { eventId: "e-1" }, "org-1")).toBe(
      "/team/calendar?orgId=org-1&eventId=e-1",
    );
    expect(notificationHref("calendar_updated", {}, "org-1")).toBe("/team/calendar?orgId=org-1");
    expect(notificationHref("scouting_coverage_gap", {}, "org-1")).toBe("/command?orgId=org-1");
    expect(notificationHref("sponsor_thank_you_due", {}, "org-1")).toBe(
      "/business?orgId=org-1&tab=sponsors",
    );
    expect(notificationHref("sponsor_renewal_due", {}, "org-1")).toBe(
      "/business?orgId=org-1&tab=sponsors",
    );
    expect(notificationHref("sponsor_followup_overdue", {}, null)).toBe("/business?tab=sponsors");
    expect(notificationHref("purchase_request_submitted", { orderId: "o-1" }, "org-1")).toBe(
      "/orders?orgId=org-1&orderId=o-1",
    );
    expect(notificationHref("purchase_request_approved", {}, "org-1")).toBe("/orders?orgId=org-1");
    expect(notificationHref("unknown", {})).toBeNull();
    expect(notificationHref("x", { href: "/custom" })).toBe("/custom");
  });
});
