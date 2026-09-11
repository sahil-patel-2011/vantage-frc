import { describe, expect, it } from "vitest";
import {
  TEAM_ADMIN_RELATED_INCLUDE,
  classifyTeamAdminShell,
  formatTeamAdminMetric,
  isTeamAdminBoardEmpty,
  shouldShowTeamAdminSummaryTiles,
  teamAdminCardPrimaryHref,
  teamAdminNextActions,
  teamAdminRelatedLinks,
  teamAdminSetupSteps,
  teamAdminShellCopy,
} from "./team-admin-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("teamAdminRelatedLinks", () => {
  it("builds Account / Discord / Connections via withOrgHref", () => {
    const links = teamAdminRelatedLinks("org-1", {
      include: [...TEAM_ADMIN_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["account", "discord", "connections"]);
    expect(links.find((l) => l.id === "account")?.href).toBe("/account?tab=profile");
    expect(links.find((l) => l.id === "discord")?.href).toBe("/team/discord?orgId=org-1");
    expect(links.find((l) => l.id === "connections")?.href).toBe("/connectors");
  });

  it("excludes the active surface and respects include", () => {
    const links = teamAdminRelatedLinks("org-1", {
      active: "account",
      include: ["discord", "connections"],
    });
    expect(links.map((l) => l.id)).toEqual(["discord", "connections"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(teamAdminRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("teamAdminSetupSteps", () => {
  it("keeps Choose your team + invite; Discord / Connections live on the related strip", () => {
    const steps = teamAdminSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["workspace", "invite"]);
    expect(steps.find((s) => s.id === "invite")?.href).toBe("/team/admin?orgId=org-1#membership");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
  });

  it("no-org setup is only Choose your team", () => {
    expect(teamAdminSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
    expect(teamAdminCardPrimaryHref(null)).toBe("/workspace");
  });
});

describe("Team admin Soft-UI metrics", () => {
  it("formats real member counts only", () => {
    expect(formatTeamAdminMetric(3, true)).toBe("3");
    expect(formatTeamAdminMetric(0, false)).toBe("…");
    expect(formatTeamAdminMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without real members or invites", () => {
    expect(shouldShowTeamAdminSummaryTiles({ memberCount: 0, inviteCount: 0 })).toBe(false);
    expect(shouldShowTeamAdminSummaryTiles({ memberCount: 2, inviteCount: 0 })).toBe(true);
    expect(shouldShowTeamAdminSummaryTiles({ memberCount: 0, inviteCount: 1 })).toBe(true);
  });

  it("treats zero-member boards as empty", () => {
    expect(isTeamAdminBoardEmpty({ memberCount: 0 })).toBe(true);
    expect(isTeamAdminBoardEmpty({ memberCount: 1 })).toBe(false);
  });
});

describe("classifyTeamAdminShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyTeamAdminShell({ loading: true })).toBe("loading");
    expect(classifyTeamAdminShell({ fetchFailed: true, hasOrgs: true, orgId: "o" })).toBe("error");
    expect(classifyTeamAdminShell({ hasOrgs: false })).toBe("setup");
    expect(classifyTeamAdminShell({ hasOrgs: true, orgId: null })).toBe("setup");
    expect(classifyTeamAdminShell({ hasOrgs: true, orgId: "o", memberCount: 0 })).toBe("empty");
    expect(classifyTeamAdminShell({ hasOrgs: true, orgId: "o", memberCount: 2 })).toBe("ready");
  });
});

describe("teamAdminShellCopy", () => {
  it("refuses invented DEMO members in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = teamAdminShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expectPlainCopy(teamAdminShellCopy("empty").description);
    expectPlainCopy(teamAdminShellCopy("setup").description);
    expect(teamAdminShellCopy("setup").description).not.toMatch(/pick a team/i);
    expect(teamAdminShellCopy("setup").badge).toBe("Needs setup");
    expect(teamAdminShellCopy("empty").title).toBe("Invite someone by exact email");
    expect(teamAdminShellCopy("empty").description).toMatch(/waitlist/);
  });
});

describe("teamAdminNextActions", () => {
  it("prioritizes workspace when no org and does not repeat the related strip", () => {
    const actions = teamAdminNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("empty shell points at invite, not Account / Discord / Connections", () => {
    const actions = teamAdminNextActions({
      orgId: "org-1",
      shell: "empty",
      memberCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(["invite"]);
    expect(actions[0]?.href).toBe("#invite-form");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("ready boards prioritize invite without repeating the related strip", () => {
    const actions = teamAdminNextActions({
      orgId: "org-1",
      shell: "ready",
      memberCount: 4,
      pendingInviteCount: 0,
      pendingAccessCount: 0,
    });
    expect(actions[0]?.id).toBe("invite");
    expect(actions.map((a) => a.id)).toEqual(["invite", "roles"]);
    expect(actions.find((a) => a.id === "roles")?.href).toBe("/roles?orgId=org-1");
  });

  it("does not repeat header related-strip destinations as next actions", () => {
    const related = new Set(
      teamAdminRelatedLinks("org-1", { include: [...TEAM_ADMIN_RELATED_INCLUDE] }).map(
        (link) => link.href,
      ),
    );
    for (const shell of ["empty", "setup", "ready"] as const) {
      const actions = teamAdminNextActions({
        orgId: "org-1",
        shell,
        memberCount: 4,
        pendingInviteCount: 0,
        pendingAccessCount: 0,
      });
      expect(actions.every((action) => !related.has(action.href))).toBe(true);
    }
    const noOrg = teamAdminNextActions({ orgId: null, shell: "setup" });
    const relatedNoOrg = new Set(
      teamAdminRelatedLinks(null, { include: [...TEAM_ADMIN_RELATED_INCLUDE] }).map((link) => link.href),
    );
    expect(noOrg.every((action) => !relatedNoOrg.has(action.href))).toBe(true);
  });

  it("surfaces pending access requests before invite ledger", () => {
    const actions = teamAdminNextActions({
      orgId: "org-1",
      shell: "ready",
      memberCount: 3,
      pendingAccessCount: 2,
      pendingInviteCount: 1,
    });
    expect(actions[0]?.id).toBe("access");
  });
});
