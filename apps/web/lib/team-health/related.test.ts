import { describe, expect, it } from "vitest";
import {
  TEAM_HEALTH_RELATED_INCLUDE,
  classifyTeamHealthShell,
  formatTeamHealthRate,
  shouldShowTeamHealthSummaryTiles,
  teamHealthNextActions,
  teamHealthRelatedLinks,
  teamHealthShellCopy,
} from "./related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("teamHealthRelatedLinks", () => {
  it("builds Attendance / My hours cross-links", () => {
    const links = teamHealthRelatedLinks("org-1", {
      include: [...TEAM_HEALTH_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["attendance", "hours-self-view"]);
    expect(links.find((l) => l.id === "attendance")?.href).toBe("/team?tab=attendance&orgId=org-1");
    expect(links.find((l) => l.id === "hours-self-view")?.href).toBe("/team?tab=hours-self-view&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(teamHealthRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/moraleRating|avgMorale|morale_score/i);
  });
});

describe("teamHealthNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = teamHealthNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "attendance")).toBe(true);
    expect(actions.some((a) => a.id === "hours-self-view")).toBe(true);
  });

  it("points empty boards at Attendance and Hours", () => {
    const actions = teamHealthNextActions({ orgId: "org-1", shell: "empty", hasLogs: false });
    expect(actions[0]?.id).toBe("attendance");
    expect(actions.some((a) => a.id === "hours-self-view")).toBe(true);
    expect(actions.every((a) => !/\bDEMO morale score/i.test(`${a.label} ${a.detail}`))).toBe(true);
    actions.forEach((a) => expectPlainCopy(a.detail));
  });

  it("ready boards prioritize check-ins when roster members have no logs", () => {
    const actions = teamHealthNextActions({
      orgId: "org-1",
      shell: "ready",
      hasLogs: true,
      checkInCount: 2,
    });
    expect(actions[0]?.id).toBe("check-ins");
    expect(actions[0]?.href).toBe("#team-health-checkins");
  });
});

describe("team health shell", () => {
  it("classifies empty until logs exist", () => {
    expect(
      classifyTeamHealthShell({
        status: "live",
        orgId: "org-1",
        hasLogs: false,
      }),
    ).toBe("empty");
    expect(
      classifyTeamHealthShell({
        status: "live",
        orgId: "org-1",
        hasLogs: true,
      }),
    ).toBe("ready");
    expect(shouldShowTeamHealthSummaryTiles(false)).toBe(false);
    expect(shouldShowTeamHealthSummaryTiles(true)).toBe(true);
    expect(formatTeamHealthRate(null, true)).toBe("—");
    expect(formatTeamHealthRate(0.5, true)).toBe("50%");
    expectPlainCopy(teamHealthShellCopy("empty").description);
  });
});
