import { describe, expect, it } from "vitest";
import { activeAdminGroup } from "../../app/admin/admin-subnav";
import { adminRelatedLinks } from "../admin";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  formatScreenSize,
  isFeedbackStatus,
  mapFeedbackRow,
  newFeedbackBadge,
  parseFeedbackFilters,
} from "./admin-feedback";

describe("parseFeedbackFilters", () => {
  it("reads a kind and a status", () => {
    expect(parseFeedbackFilters(new URLSearchParams("kind=idea&status=triaged"))).toEqual({
      kind: "idea",
      status: "triaged",
    });
  });

  it("treats anything it does not know as 'all', so an old bookmark shows everything", () => {
    expect(parseFeedbackFilters(new URLSearchParams("kind=praise&status=done"))).toEqual({ kind: null, status: null });
    expect(parseFeedbackFilters(new URLSearchParams(""))).toEqual({ kind: null, status: null });
  });
});

describe("statuses", () => {
  it("run new, triaged, fixed, won't fix, in the words an operator reads", () => {
    expect([...FEEDBACK_STATUSES]).toEqual(["new", "triaged", "fixed", "wont_fix"]);
    expect(FEEDBACK_STATUS_LABELS.wont_fix).toBe("Won't fix");
    expect(isFeedbackStatus("fixed")).toBe(true);
    expect(isFeedbackStatus("closed")).toBe(false);
  });
});

describe("newFeedbackBadge", () => {
  it("shows nothing when nothing is new, and caps a long queue", () => {
    expect(newFeedbackBadge(0)).toBe("");
    expect(newFeedbackBadge(null)).toBe("");
    expect(newFeedbackBadge(undefined)).toBe("");
    expect(newFeedbackBadge(3)).toBe("3");
    expect(newFeedbackBadge(250)).toBe("99+");
  });
});

describe("mapFeedbackRow", () => {
  const base = {
    id: "id-1",
    kind: "idea",
    status: "new",
    description: "d",
    severity: null,
    route: "/help",
    clientInfo: { viewportWidth: 1280.4, viewportHeight: "800", userAgent: "ignored" },
    createdAt: new Date("2026-10-10T12:00:00Z"),
    orgId: null,
    orgName: null,
    teamNumber: null,
    reporterName: null,
    reporterEmail: "a@example.test",
  };

  it("reads the screen size out of the stored client info and nothing else", () => {
    const item = mapFeedbackRow(base);
    expect(item.viewportWidth).toBe(1280);
    expect(item.viewportHeight).toBe(800);
    expect(item).not.toHaveProperty("userAgent");
    expect(item.createdAt).toBe("2026-10-10T12:00:00.000Z");
  });

  it("copes with a note that carried no client info", () => {
    const item = mapFeedbackRow({ ...base, clientInfo: null });
    expect(item.viewportWidth).toBeNull();
    expect(formatScreenSize(item.viewportWidth, item.viewportHeight)).toBeNull();
    expect(formatScreenSize(390, 844)).toBe("390 × 844");
  });

  it("files an unrecognised kind or status as a new problem rather than hiding it", () => {
    const item = mapFeedbackRow({ ...base, kind: "weird", status: "weird" });
    expect(item.kind).toBe("bug");
    expect(item.status).toBe("new");
  });
});

describe("where the Feedback view lives in /admin", () => {
  it("sits with the other inboxes under Data, and the page is reachable from the related links", () => {
    const group = activeAdminGroup("/admin/feedback");
    expect(group.label).toBe("Data");
    expect(group.links.map((link) => link.href)).toContain("/admin/feedback");
    expect(adminRelatedLinks().some((link) => link.href === "/admin/feedback")).toBe(true);
  });
});
