import { describe, expect, it } from "vitest";
import {
  DRIVE_TEAM_SIGNALS_RELATED_INCLUDE,
  classifyDriveTeamSignalsShell,
  formatDriveTeamSignalsMetric,
  driveTeamSignalsNextActions,
  driveTeamSignalsRelatedLinks,
  driveTeamSignalsShellCopy,
  shouldShowDriveTeamSignalsSummaryTiles,
} from "./drive-team-signals-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("driveTeamSignalsRelatedLinks", () => {
  it("builds Checklist / Strategy Cards / Briefing cross-links", () => {
    const links = driveTeamSignalsRelatedLinks("org-1", {
      include: [...DRIVE_TEAM_SIGNALS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual([
      "match-checklist",
      "match-strategy-cards",
      "briefing",
    ]);
    expect(links.find((l) => l.id === "match-checklist")?.href).toBe(
      "/competition?tab=match-checklist&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(driveTeamSignalsRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("driveTeamSignalsNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = driveTeamSignalsNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "checklist")).toBe(true);
  });

  it("points empty boards at create-sheet", () => {
    const actions = driveTeamSignalsNextActions({
      orgId: "org-1",
      shell: "empty",
      sheetCount: 0,
    });
    expect(actions[0]?.id).toBe("create-sheet");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize signals without DEMO metrics", () => {
    const actions = driveTeamSignalsNextActions({
      orgId: "org-1",
      shell: "ready",
      sheetCount: 2,
      signalCount: 8,
    });
    expect(actions[0]?.id).toBe("review-signals");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyDriveTeamSignalsShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyDriveTeamSignalsShell({ loading: true })).toBe("loading");
    expect(classifyDriveTeamSignalsShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyDriveTeamSignalsShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyDriveTeamSignalsShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        sheetCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyDriveTeamSignalsShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        sheetCount: 2,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatDriveTeamSignalsMetric(4, true)).toBe("4");
    expect(shouldShowDriveTeamSignalsSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowDriveTeamSignalsSummaryTiles(1, 0)).toBe(true);
  });

  it("copy never invents DEMO cheat sheets", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = driveTeamSignalsShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
