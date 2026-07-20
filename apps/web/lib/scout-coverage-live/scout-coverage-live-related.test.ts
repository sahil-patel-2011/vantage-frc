import { describe, expect, it } from "vitest";
import {
  SCOUT_COVERAGE_LIVE_RELATED_INCLUDE,
  classifyScoutCoverageLiveShell,
  formatScoutCoverageLiveMetric,
  formatScoutCoverageLiveRate,
  isScoutCoverageLiveEmpty,
  scoutCoverageLiveNextActions,
  scoutCoverageLiveRelatedLinks,
  scoutCoverageLiveSetupSteps,
  scoutCoverageLiveShellCopy,
  shouldShowScoutCoverageLiveSummaryTiles,
} from "./scout-coverage-live-related";

describe("scoutCoverageLiveRelatedLinks", () => {
  it("builds Scouting / Lineup / Cross-Validation via hubHref / withOrgHref", () => {
    const links = scoutCoverageLiveRelatedLinks("org-1", {
      include: [...SCOUT_COVERAGE_LIVE_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "lineup", "crossval"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "lineup")?.href).toBe("/scouting/lineup?orgId=org-1");
    expect(links.find((l) => l.id === "crossval")?.href).toBe("/scout-crossval?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scoutCoverageLiveRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("scoutCoverageLiveSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO coverage", () => {
    const steps = scoutCoverageLiveSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "lineup")?.href).toBe("/scouting/lineup?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Scout Coverage Live Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatScoutCoverageLiveMetric(3, true)).toBe("3");
    expect(formatScoutCoverageLiveMetric(0, false)).toBe("…");
    expect(formatScoutCoverageLiveMetric(-1, true)).toBe("0");
  });

  it("formats rates without inventing DEMO %", () => {
    expect(formatScoutCoverageLiveRate(0.5, true)).toBe("50%");
    expect(formatScoutCoverageLiveRate(0, false)).toBe("…");
    expect(formatScoutCoverageLiveRate(null, true)).toBe("—");
    expect(formatScoutCoverageLiveRate(0, true, { hasSchedule: false })).toBe("—");
  });

  it("hides summary tiles without schedule cells", () => {
    expect(shouldShowScoutCoverageLiveSummaryTiles({ totalCells: 0 })).toBe(false);
    expect(shouldShowScoutCoverageLiveSummaryTiles({ totalCells: 4 })).toBe(true);
  });

  it("classifies empty vs ready without DEMO coverage", () => {
    expect(isScoutCoverageLiveEmpty({ totalCells: 0 })).toBe(true);
    expect(classifyScoutCoverageLiveShell({ status: "live", orgId: "o", totalCells: 0 })).toBe(
      "empty",
    );
    expect(classifyScoutCoverageLiveShell({ status: "live", orgId: "o", totalCells: 2 })).toBe(
      "ready",
    );
    expect(scoutCoverageLiveShellCopy("empty").title).not.toMatch(/\bDEMO\b/);
    expect(scoutCoverageLiveShellCopy("empty").description).toMatch(/never DEMO/i);
  });

  it("next actions point at real hubs", () => {
    const actions = scoutCoverageLiveNextActions({
      orgId: "org-1",
      shell: "ready",
      gapCount: 2,
    });
    expect(actions[0]?.href).toBe("#coverage-gaps");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });
});
