import { describe, expect, it } from "vitest";
import {
  formatWorkspaceOrgLabel,
  workspaceJoinCopy,
  workspaceJoinNextActions,
} from "./workspace-join";

describe("workspace Soft-UI join helpers", () => {
  it("formats org labels without inventing team numbers", () => {
    expect(formatWorkspaceOrgLabel({ orgName: "Vantage", teamNumber: 254 })).toBe("Team 254 · Vantage");
    expect(formatWorkspaceOrgLabel({ orgName: "Solo", teamNumber: null })).toBe("Solo");
  });

  it("keeps empty join copy invite-based and closed", () => {
    expect(workspaceJoinCopy("none").description).toMatch(/exact email/i);
    expect(workspaceJoinCopy("select").title).toMatch(/Select/i);
    const none = workspaceJoinNextActions("none");
    expect(none[0]?.primary).toBe(true);
    expect(none.some((a) => a.href === "/onboarding")).toBe(true);
  });
});
