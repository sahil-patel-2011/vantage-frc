import { describe, expect, it } from "vitest";
import {
  TEAM_ADMIN_RELATED_INCLUDE,
  classifyTeamAdminShell,
  formatTeamAdminMetric,
  isTeamAdminBoardEmpty,
  shouldShowTeamAdminSummaryTiles,
  teamAdminNextActions,
  teamAdminRelatedLinks,
  teamAdminSetupSteps,
  teamAdminShellCopy,
} from "./team-admin-related";

describe("teamAdminRelatedLinks", () => {
  it("builds Account / Discord / Connections via withOrgHref", () => {
    const links = teamAdminRelatedLinks("org-1", {
      include: [...TEAM_ADMIN_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["account", "discord", "connections"]);
    expect(links.find((l) => l.id === "account")?.href).toBe("/account?tab=profile");
    expect(links.find((l) => l.id === "discord")?.href).toBe("/team/discord?orgId=org-1");
    expect(links.find((l) => l.id === "connections")?.href).toBe("/account?tab=integrations");
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
  it("points setup at Workspace + invite / Discord / Connections", () => {
    const steps = teamAdminSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["workspace", "invite", "discord", "connections"]);
    expect(steps.find((s) => s.id === "invite")?.href).toBe("/team/admin?orgId=org-1#membership");
    expect(steps.find((s) => s.id === "discord")?.href).toBe("/team/discord?orgId=org-1");
    expect(steps.find((s) => s.id === "connections")?.href).toBe("/account?tab=integrations");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
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
    expect(teamAdminShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(teamAdminShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("teamAdminNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = teamAdminNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "account")).toBe(true);
    expect(actions.some((a) => a.id === "discord")).toBe(true);
    expect(actions.some((a) => a.id === "connections")).toBe(true);
  });

  it("empty shell points at invite + Account / Discord / Connections", () => {
    const actions = teamAdminNextActions({
      orgId: "org-1",
      shell: "empty",
      memberCount: 0,
    });
    expect(actions[0]?.id).toBe("invite");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["account", "discord", "connections"]),
    );
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("ready boards prioritize invite without DEMO members", () => {
    const actions = teamAdminNextActions({
      orgId: "org-1",
      shell: "ready",
      memberCount: 4,
      pendingInviteCount: 0,
      pendingAccessCount: 0,
    });
    expect(actions[0]?.id).toBe("invite");
    expect(actions.find((a) => a.id === "discord")?.href).toBe("/team/discord?orgId=org-1");
    expect(actions.find((a) => a.id === "connections")?.href).toBe("/account?tab=integrations");
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
