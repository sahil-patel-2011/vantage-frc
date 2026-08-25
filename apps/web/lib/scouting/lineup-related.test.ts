import { describe, expect, it } from "vitest";
import { buildCoverageGapBoard } from "@vantage/scouting/coverage";
import {
  LINEUP_POLL_MS,
  LINEUP_RELATED_INCLUDE,
  buildLineupCoverageSlots,
  classifyLineupShell,
  defaultLineupFocusMatchKey,
  shouldPollLineup,
  formatLineupCoverage,
  formatLineupMetric,
  isLineupBoardEmpty,
  lineupNextActions,
  lineupRelatedLinks,
  lineupScoutNowHref,
  lineupSetupSteps,
  lineupShellCopy,
  shouldShowLineupSummaryTiles,
} from "./lineup-related";

describe("lineupRelatedLinks", () => {
  it("builds Scouting / Strategy / Form builder via hubHref", () => {
    const links = lineupRelatedLinks("org-1", {
      include: [...LINEUP_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "strategy", "forms"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "forms")?.href).toBe("/competition?tab=forms&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(lineupRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("lineupSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO %", () => {
    const steps = lineupSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "forms")?.href).toBe("/competition?tab=forms&orgId=org-1");
    expect(steps.find((s) => s.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Lineup Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatLineupMetric(3, true)).toBe("3");
    expect(formatLineupMetric(0, false)).toBe("…");
    expect(formatLineupMetric(-1, true)).toBe("0");
  });

  it("formats coverage without inventing DEMO %", () => {
    expect(formatLineupCoverage(0.5, true)).toBe("50%");
    expect(formatLineupCoverage(0, false)).toBe("…");
    expect(formatLineupCoverage(null, true)).toBe("—");
    expect(formatLineupCoverage(2, true)).toBe("100%");
  });

  it("hides summary tiles without real slots", () => {
    expect(shouldShowLineupSummaryTiles(0)).toBe(false);
    expect(shouldShowLineupSummaryTiles(6)).toBe(true);
  });

  it("treats zero slots as empty", () => {
    expect(isLineupBoardEmpty({ totalSlots: 0 })).toBe(true);
    expect(isLineupBoardEmpty({ totalSlots: 2 })).toBe(false);
  });

  it("builds scout-now links via hubHref", () => {
    expect(lineupScoutNowHref("org-1", "2026casj_qm1", "frc254")).toBe(
      "/competition?tab=scouting&orgId=org-1&matchKey=2026casj_qm1&teamKey=frc254",
    );
  });
});

describe("classifyLineupShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO %", () => {
    expect(classifyLineupShell({ loading: true })).toBe("loading");
    expect(classifyLineupShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyLineupShell({ status: "setup_required" })).toBe("setup");
    expect(classifyLineupShell({ orgId: null, status: "live" })).toBe("setup");
    expect(classifyLineupShell({ orgId: "o", status: "live", totalSlots: 0 })).toBe("empty");
    expect(classifyLineupShell({ orgId: "o", status: "live", totalSlots: 12 })).toBe("ready");
  });
});

describe("lineupShellCopy", () => {
  it("refuses invented DEMO % in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = lineupShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(lineupShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(lineupShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("lineup live polling", () => {
  it("keeps a tablet-friendly cadence of at least 15s", () => {
    expect(LINEUP_POLL_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("pauses while the tab is hidden", () => {
    expect(shouldPollLineup("hidden")).toBe(false);
    expect(shouldPollLineup("visible")).toBe(true);
    // SSR / older engines without visibilityState default to polling.
    expect(shouldPollLineup(undefined)).toBe(true);
  });
});

describe("buildLineupCoverageSlots", () => {
  const matches = [
    {
      matchKey: "2026casj_qm1",
      matchNumber: 1,
      compLevel: "qm",
      redAlliance: { teamKeys: ["frc254", "frc1678"] },
      blueAlliance: { teamKeys: ["frc973"] },
      eventTime: "2026-03-01T17:00:00Z",
    },
    {
      matchKey: "2026casj_qm2",
      matchNumber: 2,
      compLevel: "qm",
      redAlliance: null,
      blueAlliance: { teamKeys: ["frc118"] },
    },
  ];

  it("builds one slot per real alliance robot with true counts — never invented", () => {
    const slots = buildLineupCoverageSlots({
      matches,
      assignments: [{ matchKey: "2026casj_qm1", teamKey: "frc973", count: 1 }],
      entryScouts: [
        { matchKey: "2026casj_qm1", teamKey: "frc254", scoutUserId: "u1", scoutName: "Ada" },
        { matchKey: "2026casj_qm1", teamKey: "frc254", scoutUserId: "u2", scoutName: null },
      ],
    });
    expect(slots).toHaveLength(4);
    const doubled = slots.find((s) => s.teamKey === "frc254");
    expect(doubled?.entryCount).toBe(2);
    expect(doubled?.alliance).toBe("red");
    expect(doubled?.scoutUserIds).toEqual(["u1", "u2"]);
    expect(doubled?.scoutNames).toEqual(["Ada", "Team scout"]);
    const assigned = slots.find((s) => s.teamKey === "frc973");
    expect(assigned?.assignmentCount).toBe(1);
    expect(assigned?.entryCount).toBe(0);
    const untouched = slots.find((s) => s.teamKey === "frc118");
    expect(untouched?.assignmentCount).toBe(0);
    expect(untouched?.entryCount).toBe(0);
  });

  it("classifies through the shared compute layer", () => {
    const board = buildCoverageGapBoard(
      buildLineupCoverageSlots({
        matches,
        assignments: [{ matchKey: "2026casj_qm1", teamKey: "frc973", count: 1 }],
        entryScouts: [
          { matchKey: "2026casj_qm1", teamKey: "frc254", scoutUserId: "u1", scoutName: "Ada" },
          { matchKey: "2026casj_qm1", teamKey: "frc254", scoutUserId: "u2", scoutName: "Grace" },
          { matchKey: "2026casj_qm1", teamKey: "frc1678", scoutUserId: "u1", scoutName: "Ada" },
        ],
      }),
    );
    expect(board.find((s) => s.teamKey === "frc254")?.status).toBe("double");
    expect(board.find((s) => s.teamKey === "frc1678")?.status).toBe("covered");
    expect(board.find((s) => s.teamKey === "frc973")?.status).toBe("assigned");
    expect(board.find((s) => s.teamKey === "frc118")?.status).toBe("unscouted");
  });

  it("returns no slots for an empty schedule — honest empty state", () => {
    expect(buildLineupCoverageSlots({ matches: [], assignments: [], entryScouts: [] })).toEqual([]);
  });
});

describe("defaultLineupFocusMatchKey", () => {
  it("anchors on the first match still needing coverage", () => {
    expect(
      defaultLineupFocusMatchKey([
        { matchKey: "qm1", status: "covered" },
        { matchKey: "qm1", status: "double" },
        { matchKey: "qm2", status: "assigned" },
        { matchKey: "qm3", status: "unscouted" },
      ]),
    ).toBe("qm2");
  });

  it("returns null when everything is covered", () => {
    expect(
      defaultLineupFocusMatchKey([
        { matchKey: "qm1", status: "covered" },
        { matchKey: "qm2", status: "double" },
      ]),
    ).toBeNull();
    expect(defaultLineupFocusMatchKey([])).toBeNull();
  });
});

describe("lineupNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = lineupNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "forms")).toBe(true);
  });

  it("setup with org points at Event Day + Scouting / Form builder / Strategy", () => {
    const actions = lineupNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("command");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "forms")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at schedule sync + Scouting / Form builder / Strategy", () => {
    const actions = lineupNextActions({
      orgId: "org-1",
      shell: "empty",
      totalSlots: 0,
    });
    expect(actions[0]?.id).toBe("command");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["scouting", "forms", "strategy"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize gaps without DEMO %", () => {
    const actions = lineupNextActions({
      orgId: "org-1",
      shell: "ready",
      totalSlots: 12,
      unscouted: 3,
      gapCount: 2,
    });
    expect(actions[0]?.id).toBe("gaps");
    expect(actions[0]?.href).toBe("#lineup-gaps");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "forms")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
