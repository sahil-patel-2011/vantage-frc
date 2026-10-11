import { describe, expect, it } from "vitest";
import { VIEW_ONLY_MESSAGE, isViewOnlyIn, viewOnlyFromMe } from "./view-only";
import { canDeleteCalendarEvent } from "../subteam-calendar";
import { canDeleteSeasonMilestone } from "../season-calendar";

const ORG = "6925a000-0000-4000-8000-000000000001";
const OTHER = "6925a000-0000-4000-8000-000000000009";

describe("View only on the client", () => {
  it("reads the membership for this team, else the account role", () => {
    const memberships = [
      { orgId: ORG, role: "viewer" },
      { orgId: OTHER, role: "scout" },
    ];
    expect(isViewOnlyIn(memberships, ORG)).toBe(true);
    expect(isViewOnlyIn(memberships, OTHER)).toBe(false);
    expect(isViewOnlyIn([], null, "viewer")).toBe(true);
    expect(isViewOnlyIn(memberships, OTHER, "viewer")).toBe(false);
    expect(isViewOnlyIn(null, ORG, null)).toBe(false);
  });

  it("reads /api/me", () => {
    expect(viewOnlyFromMe({ role: "viewer", memberships: [{ orgId: ORG, role: "viewer" }] }, ORG)).toBe(true);
    expect(viewOnlyFromMe({ role: "scout", memberships: [{ orgId: ORG, role: "scout" }] }, ORG)).toBe(false);
    expect(viewOnlyFromMe(null, ORG)).toBe(false);
    expect(viewOnlyFromMe({ memberships: "nope" }, ORG)).toBe(false);
  });

  it("shows the same sentence the API answers with", () => {
    expect(VIEW_ONLY_MESSAGE).toMatch(/^View only — you can look but not change this\./);
  });

  it("never offers edit/delete on calendar entries to a viewer, even their own", () => {
    const own = { role: "viewer", userId: "u1", authorId: "u1" };
    expect(canDeleteCalendarEvent(own)).toBe(false);
    expect(canDeleteSeasonMilestone(own)).toBe(false);
    expect(canDeleteCalendarEvent({ ...own, role: "scout" })).toBe(true);
    expect(canDeleteSeasonMilestone({ ...own, role: "scout" })).toBe(true);
  });
});
