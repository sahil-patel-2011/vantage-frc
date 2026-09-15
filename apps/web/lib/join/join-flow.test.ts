import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../ui/copy-assertions";
import { joinOneAccountCopy, joinPreviewDetail, joinPreviewHeadline, joinSignInHref } from "./join-flow";
import { clampJoinLinkMaxUses, JOIN_LINK_MAX_USES, parseJoinLinkMemberRole } from "@vantage/core";

describe("open join links", () => {
  it("keeps Google and email on one sign-in URL", () => {
    const href = joinSignInHref("abc");
    expect(href).toMatch(/^\/signin\?next=/);
    expect(decodeURIComponent(href)).toContain("/join?token=abc");
    expectPlainCopy(joinOneAccountCopy());
    expect(joinOneAccountCopy()).toMatch(/same email/);
  });

  it("explains open / full / expired links without invented scores", () => {
    const open = {
      orgId: "11111111-1111-4111-8111-111111111111",
      orgName: "Robodogs",
      teamNumber: 6925,
      memberRole: "scout" as const,
      status: "open" as const,
      remaining: 48,
      maxUses: 50,
      expiresAt: "2026-10-01T00:00:00.000Z",
    };
    expect(joinPreviewHeadline(open)).toBe("Join Team 6925");
    expectPlainCopy(joinPreviewDetail(open));
    expect(joinPreviewHeadline({ ...open, status: "full" })).toMatch(/full/i);
    expect(joinPreviewHeadline({ ...open, status: "expired" })).toMatch(/expired/i);
    expect(joinPreviewHeadline(null)).toMatch(/not valid/i);
    expectPlainCopy(joinPreviewDetail(null));
  });

  it("caps a join link at 50 scout seats", () => {
    expect(JOIN_LINK_MAX_USES).toBe(50);
    expect(clampJoinLinkMaxUses(999)).toBe(50);
    expect(clampJoinLinkMaxUses(0)).toBe(1);
    expect(parseJoinLinkMemberRole("viewer")).toBe("viewer");
    expect(parseJoinLinkMemberRole("owner")).toBe("scout");
  });
});
