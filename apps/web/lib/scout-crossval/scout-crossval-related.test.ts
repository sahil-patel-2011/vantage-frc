import { describe, expect, it } from "vitest";
import {
  SCOUT_CROSSVAL_RELATED_INCLUDE,
  classifyScoutCrossvalShell,
  formatScoutCrossvalMetric,
  formatScoutCrossvalRate,
  isScoutCrossvalEmpty,
  scoutCrossvalNextActions,
  scoutCrossvalRelatedLinks,
  scoutCrossvalSetupSteps,
  scoutCrossvalShellCopy,
  shouldShowScoutCrossvalSummaryTiles,
} from "./scout-crossval-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("scoutCrossvalRelatedLinks", () => {
  it("builds Scouting / Coverage Live / Accuracy via hubHref / withOrgHref", () => {
    const links = scoutCrossvalRelatedLinks("org-1", {
      include: [...SCOUT_CROSSVAL_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "coverage-live", "accuracy"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "coverage-live")?.href).toBe(
      "/scout-coverage-live?orgId=org-1",
    );
    expect(links.find((l) => l.id === "accuracy")?.href).toBe("/scout-accuracy?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scoutCrossvalRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("scoutCrossvalSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO agreement", () => {
    const steps = scoutCrossvalSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "accuracy")?.href).toBe("/scout-accuracy?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Scout Crossval Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatScoutCrossvalMetric(3, true)).toBe("3");
    expect(formatScoutCrossvalMetric(0, false)).toBe("…");
    expect(formatScoutCrossvalMetric(-1, true)).toBe("0");
  });

  it("formats rates without inventing DEMO %", () => {
    expect(formatScoutCrossvalRate(0.5, true)).toBe("50%");
    expect(formatScoutCrossvalRate(0, false)).toBe("…");
    expect(formatScoutCrossvalRate(null, true)).toBe("—");
    expect(formatScoutCrossvalRate(0, true, { hasVerifiable: false })).toBe("—");
  });

  it("hides summary tiles without entries", () => {
    expect(shouldShowScoutCrossvalSummaryTiles({ totalEntries: 0 })).toBe(false);
    expect(shouldShowScoutCrossvalSummaryTiles({ totalEntries: 4 })).toBe(true);
  });

  it("classifies empty vs ready without DEMO agreement", () => {
    expect(isScoutCrossvalEmpty({ totalEntries: 0 })).toBe(true);
    expect(classifyScoutCrossvalShell({ status: "live", orgId: "o", totalEntries: 0 })).toBe(
      "empty",
    );
    expect(classifyScoutCrossvalShell({ status: "live", orgId: "o", totalEntries: 2 })).toBe(
      "ready",
    );
    expect(scoutCrossvalShellCopy("empty").title).not.toMatch(/\bDEMO\b/);
    expectPlainCopy(scoutCrossvalShellCopy("empty").description);
  });

  it("next actions point at real hubs", () => {
    const actions = scoutCrossvalNextActions({
      orgId: "org-1",
      shell: "ready",
      conflictEntries: 2,
      totalEntries: 5,
    });
    expect(actions[0]?.href).toBe("#crossval-entries");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });
});
