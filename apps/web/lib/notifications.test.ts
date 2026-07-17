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
    expect(notificationHref("unknown", {})).toBeNull();
    expect(notificationHref("x", { href: "/custom" })).toBe("/custom");
  });
});
