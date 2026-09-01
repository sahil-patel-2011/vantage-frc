import { describe, expect, it } from "vitest";
import {
  assertCanDeleteResponse,
  assertCanEditResponse,
  canEditResponse,
  ExitInterviewError,
  hasHandoffContent,
  nextStatus,
  shouldPublishWiki,
} from "./lifecycle";

const AUTHOR = "aaaaaaaa-1111-4111-8111-111111111111";
const GRADUATE = "bbbbbbbb-2222-4222-8222-222222222222";
const STRANGER = "cccccccc-3333-4333-8333-333333333333";

const draft = { status: "draft" as const, submittedBy: AUTHOR, memberUserId: GRADUATE };
const submitted = { status: "submitted" as const, submittedBy: AUTHOR, memberUserId: GRADUATE };

describe("canEditResponse", () => {
  it("lets the author finish their own draft", () => {
    expect(canEditResponse({ role: "member", userId: AUTHOR }, draft)).toBe(true);
  });

  it("lets the graduating member edit a draft filed about them", () => {
    expect(canEditResponse({ role: "member", userId: GRADUATE }, draft)).toBe(true);
  });

  it("keeps another member out of someone else's draft", () => {
    expect(canEditResponse({ role: "member", userId: STRANGER }, draft)).toBe(false);
  });

  it("freezes a submitted record against its own author", () => {
    expect(canEditResponse({ role: "member", userId: AUTHOR }, submitted)).toBe(false);
  });

  it("lets a mentor edit anything", () => {
    expect(canEditResponse({ role: "admin", userId: STRANGER }, submitted)).toBe(true);
    expect(canEditResponse({ role: "owner", userId: STRANGER }, draft)).toBe(true);
  });

  it("still refuses an unlinked draft to a member who is neither author nor subject", () => {
    expect(
      canEditResponse({ role: "member", userId: STRANGER }, { ...draft, memberUserId: null }),
    ).toBe(false);
  });
});

describe("assertCanEditResponse", () => {
  it("raises 403 with a message that names the actual rule", () => {
    try {
      assertCanEditResponse({ role: "member", userId: AUTHOR }, submitted);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ExitInterviewError);
      expect((error as ExitInterviewError).status).toBe(403);
      expect((error as Error).message).toMatch(/owner or admin/);
    }
  });

  it("passes silently when allowed", () => {
    expect(() => assertCanEditResponse({ role: "member", userId: AUTHOR }, draft)).not.toThrow();
  });
});

describe("assertCanDeleteResponse", () => {
  it("keeps deletion to mentors, including against the record's own author", () => {
    expect(() => assertCanDeleteResponse({ role: "member", userId: AUTHOR })).toThrow(
      /owner or admin/,
    );
    expect(() => assertCanDeleteResponse({ role: "owner", userId: STRANGER })).not.toThrow();
  });
});

describe("nextStatus", () => {
  it("allows a draft to be submitted", () => {
    expect(nextStatus("draft", "submitted")).toBe("submitted");
  });

  it("treats a no-op and an absent request as leaving the status alone", () => {
    expect(nextStatus("draft", "draft")).toBe("draft");
    expect(nextStatus("submitted", null)).toBe("submitted");
    expect(nextStatus("submitted", undefined)).toBe("submitted");
  });

  it("refuses to un-submit, since a published page may already be linked", () => {
    try {
      nextStatus("submitted", "draft");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ExitInterviewError);
      expect((error as ExitInterviewError).status).toBe(409);
    }
  });
});

describe("shouldPublishWiki", () => {
  it("publishes on the move from draft to submitted", () => {
    expect(
      shouldPublishWiki({ previousStatus: "draft", nextStatus: "submitted", existingPageId: null }),
    ).toBe(true);
  });

  it("does not publish while the record is still a draft", () => {
    expect(
      shouldPublishWiki({ previousStatus: "draft", nextStatus: "draft", existingPageId: null }),
    ).toBe(false);
  });

  it("does not publish a second page when one already exists", () => {
    expect(
      shouldPublishWiki({
        previousStatus: "submitted",
        nextStatus: "submitted",
        existingPageId: "page-1",
      }),
    ).toBe(false);
  });

  it("backfills a page for a record submitted before the wiki step existed", () => {
    expect(
      shouldPublishWiki({
        previousStatus: "submitted",
        nextStatus: "submitted",
        existingPageId: null,
      }),
    ).toBe(true);
  });
});

describe("hasHandoffContent", () => {
  it("recognises any one of the three answers as content", () => {
    expect(
      hasHandoffContent({ highlights: "Built the intake", adviceForFuture: null, skillsToDocument: null }),
    ).toBe(true);
    expect(
      hasHandoffContent({ highlights: null, adviceForFuture: null, skillsToDocument: "CAN wiring" }),
    ).toBe(true);
  });

  it("treats an empty or whitespace-only record as having nothing to hand off", () => {
    expect(
      hasHandoffContent({ highlights: null, adviceForFuture: null, skillsToDocument: null }),
    ).toBe(false);
    expect(
      hasHandoffContent({ highlights: "   ", adviceForFuture: "\n", skillsToDocument: "" }),
    ).toBe(false);
  });
});
