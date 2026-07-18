import { describe, expect, it } from "vitest";
import { notificationBody, notificationHref, notificationTitle } from "./notifications";

describe("notification helpers", () => {
  it("prefers payload title and body", () => {
    expect(notificationTitle("export_ready", { title: "Team export ready" })).toBe("Team export ready");
    expect(notificationBody({ body: "Available for 24 hours." })).toBe("Available for 24 hours.");
  });

  it("humanizes type when payload has no title", () => {
    expect(notificationTitle("credit_low")).toBe("Credit Low");
    expect(notificationBody({})).toBeNull();
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
    expect(notificationHref("unknown", {})).toBeNull();
    expect(notificationHref("x", { href: "/custom" })).toBe("/custom");
  });
});
