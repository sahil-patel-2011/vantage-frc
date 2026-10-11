import { describe, expect, it } from "vitest";
import { isPendingWorkspacePath } from "../onboarding/pending-paths";
import { isTeamRemoval, removalNoticeCopy } from "./removal-notice";

describe("removed from a team (QA A3-15)", () => {
  const removal = { orgId: "org-1", team: "Team 9301 · QA 3 Alpha", removedBy: "Quinn Owner", removedAt: "2026-10-11T20:00:00.000Z" };

  it("says which team, who, when, and what to do", () => {
    const copy = removalNoticeCopy(removal, () => "Oct 11");
    expect(copy.title).toBe("You were removed from Team 9301 · QA 3 Alpha");
    expect(copy.body).toBe(
      "Quinn Owner took you off the team on Oct 11. Your Vantage account and profile are still yours. If this was a mistake, ask the team's owner to invite you again.",
    );
    expect(removalNoticeCopy({ ...removal, removedBy: null, removedAt: "x" }).body.startsWith("A team lead took you off the team. ")).toBe(true);
  });

  it("reads only a well-formed notice", () => {
    expect(isTeamRemoval(removal)).toBe(true);
    expect(isTeamRemoval({ orgId: 1 })).toBe(false);
    expect(isTeamRemoval(null)).toBe(false);
  });

  it("answers while the person has no team (the proxy lets /api/onboarding/* through)", () => {
    expect(isPendingWorkspacePath("/api/onboarding/removal")).toBe(true);
  });
});
