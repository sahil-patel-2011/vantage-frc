import { describe, expect, it } from "vitest";
import {
  CROSS_TEAM_SCRIM_RELATED_INCLUDE,
  classifyCrossTeamScrimShell,
  crossTeamScrimNextActions,
  crossTeamScrimRelatedLinks,
  crossTeamScrimSetupSteps,
  crossTeamScrimShellCopy,
  formatCrossTeamScrimMetric,
  isCrossTeamScrimBoardEmpty,
  shouldShowCrossTeamScrimSummaryTiles,
} from "./cross-team-scrim-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("crossTeamScrimRelatedLinks", () => {
  it("builds Calendar / Scouting / Team Data via hubHref / withOrgHref", () => {
    const links = crossTeamScrimRelatedLinks("org-1", {
      include: [...CROSS_TEAM_SCRIM_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["calendar", "scouting", "team-data"]);
    expect(links.find((l) => l.id === "calendar")?.href).toBe("/team?tab=calendar&orgId=org-1");
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(crossTeamScrimRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("crossTeamScrimSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO metrics", () => {
    const steps = crossTeamScrimSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "calendar")?.href).toBe("/team?tab=calendar&orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Cross-Team Scrim Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatCrossTeamScrimMetric(3, true)).toBe("3");
    expect(formatCrossTeamScrimMetric(0, false)).toBe("…");
    expect(formatCrossTeamScrimMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without real invites", () => {
    expect(shouldShowCrossTeamScrimSummaryTiles({ inviteCount: 0, upcomingCount: 0 })).toBe(false);
    expect(shouldShowCrossTeamScrimSummaryTiles({ inviteCount: 1, upcomingCount: 0 })).toBe(true);
  });

  it("treats zero invites as empty", () => {
    expect(isCrossTeamScrimBoardEmpty({ inviteCount: 0 })).toBe(true);
    expect(isCrossTeamScrimBoardEmpty({ inviteCount: 2 })).toBe(false);
  });
});

describe("classifyCrossTeamScrimShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO metrics", () => {
    expect(classifyCrossTeamScrimShell({ loading: true })).toBe("loading");
    expect(classifyCrossTeamScrimShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyCrossTeamScrimShell({ status: "setup_required" })).toBe("setup");
    expect(classifyCrossTeamScrimShell({ orgId: null, status: "live" })).toBe("setup");
    expect(classifyCrossTeamScrimShell({ orgId: "o", status: "live", inviteCount: 0 })).toBe(
      "empty",
    );
    expect(classifyCrossTeamScrimShell({ orgId: "o", status: "live", inviteCount: 1 })).toBe(
      "ready",
    );
  });
});

describe("crossTeamScrimShellCopy", () => {
  it("refuses invented DEMO metrics in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = crossTeamScrimShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expectPlainCopy(crossTeamScrimShellCopy("empty").description);
    expect(crossTeamScrimShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("crossTeamScrimNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = crossTeamScrimNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "calendar")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
  });

  it("empty shell points at propose + Calendar / Scouting / Team Data", () => {
    const actions = crossTeamScrimNextActions({
      orgId: "org-1",
      shell: "empty",
      inviteCount: 0,
    });
    expect(actions[0]?.id).toBe("propose");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["calendar", "scouting", "team-data"]),
    );
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("ready boards prioritize upcoming without DEMO metrics", () => {
    const actions = crossTeamScrimNextActions({
      orgId: "org-1",
      shell: "ready",
      inviteCount: 2,
      upcomingCount: 1,
    });
    expect(actions[0]?.id).toBe("upcoming");
    expect(actions.some((a) => a.id === "team-data")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
