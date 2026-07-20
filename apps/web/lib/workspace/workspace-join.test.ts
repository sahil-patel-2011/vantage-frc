import { describe, expect, it } from "vitest";
import {
  WORKSPACE_RELATED_INCLUDE,
  classifyWorkspaceShell,
  formatWorkspaceMembershipCount,
  formatWorkspaceOrgLabel,
  realWorkspaceMemberships,
  workspaceJoinCopy,
  workspaceJoinNextActions,
  workspaceOrgHref,
  workspaceRelatedLinks,
  workspaceSetupSteps,
  workspaceShellCopy,
} from "./workspace-join";

describe("workspaceRelatedLinks", () => {
  it("builds Invite / Support / Account via hubHref / withOrgHref", () => {
    const links = workspaceRelatedLinks(null, {
      include: [...WORKSPACE_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["invite", "support", "account"]);
    expect(links.find((l) => l.id === "invite")?.href).toBe("/invite");
    expect(links.find((l) => l.id === "support")?.href).toBe("/support");
    expect(links.find((l) => l.id === "account")?.href).toBe("/account?tab=profile");
  });

  it("keeps org-exempt Invite / Support / Account without DEMO paths", () => {
    const links = workspaceRelatedLinks("org-1", {
      include: [...WORKSPACE_RELATED_INCLUDE],
    });
    expect(links.find((l) => l.id === "invite")?.href).toBe("/invite");
    expect(links.find((l) => l.id === "support")?.href).toBe("/support");
    expect(links.every((l) => !/demo/i.test(l.href))).toBe(true);
  });
});

describe("workspace Soft-UI join helpers", () => {
  it("formats org labels without inventing team numbers", () => {
    expect(formatWorkspaceOrgLabel({ orgName: "Vantage", teamNumber: 254 })).toBe("Team 254 · Vantage");
    expect(formatWorkspaceOrgLabel({ orgName: "Solo", teamNumber: null })).toBe("Solo");
  });

  it("keeps empty join copy invite-based and concise", () => {
    const empty = workspaceShellCopy("empty");
    expect(empty.description).toMatch(/invite/i);
    expect(empty.description).not.toMatch(/DEMO/i);
    expect(empty.badge).toMatch(/Invite/i);
    expect(workspaceJoinCopy("select").title).toMatch(/Choose|Select/i);
    expect(workspaceShellCopy("select").description).not.toMatch(/DEMO/i);
  });

  it("classifies shells from real membership counts only", () => {
    expect(classifyWorkspaceShell({ loading: true })).toBe("loading");
    expect(classifyWorkspaceShell({ membershipCount: 0 })).toBe("empty");
    expect(classifyWorkspaceShell({ membershipCount: 1 })).toBe("ready");
    expect(classifyWorkspaceShell({ membershipCount: 3 })).toBe("select");
  });

  it("filters blank memberships and never invents DEMO orgs", () => {
    expect(
      realWorkspaceMemberships([
        { orgId: "  ", orgName: "Ghost", teamNumber: 1 },
        { orgId: "org-1", orgName: " Real ", teamNumber: 254 },
        { orgId: null, orgName: "Missing", teamNumber: 99 },
      ]),
    ).toEqual([{ orgId: "org-1", orgName: "Real", teamNumber: 254 }]);
    expect(realWorkspaceMemberships([])).toEqual([]);
    expect(formatWorkspaceMembershipCount(0, true)).toBe("0");
    expect(formatWorkspaceMembershipCount(2, false)).toBe("…");
  });

  it("uses hubHref / withOrgHref for Invite / Support / Account next actions", () => {
    const none = workspaceJoinNextActions("none");
    expect(none[0]?.primary).toBe(true);
    expect(none.find((a) => a.id === "invite")?.href).toBe("/invite");
    expect(none.find((a) => a.id === "account")?.href).toBe("/account?tab=profile");
    expect(none.find((a) => a.id === "support")?.href).toBe("/support");
    expect(none.find((a) => a.id === "onboarding-buddy")).toBeUndefined();

    const select = workspaceJoinNextActions("select", "org-1");
    expect(select.find((a) => a.id === "invite")?.href).toBe("/invite");
    expect(select.find((a) => a.id === "support")?.href).toBe("/support");
    expect(select.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("builds setup steps with Invite / Account / Support — no Onboarding Buddy", () => {
    const steps = workspaceSetupSteps("org-1");
    expect(steps.find((s) => s.id === "invite")?.href).toBe("/invite");
    expect(steps.find((s) => s.id === "account")?.href).toBe("/account?tab=profile");
    expect(steps.find((s) => s.id === "support")?.href).toBe("/support");
    expect(steps.find((s) => s.id === "onboarding-buddy")).toBeUndefined();
    expect(workspaceOrgHref("org-1")).toBe("/workspace?orgId=org-1");
    expect(workspaceOrgHref(null)).toBe("/workspace");
  });
});
