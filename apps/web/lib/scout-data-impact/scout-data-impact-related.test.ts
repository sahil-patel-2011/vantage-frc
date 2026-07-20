import { describe, expect, it } from "vitest";
import {
  SCOUT_DATA_IMPACT_RELATED_INCLUDE,
  classifyScoutDataImpactShell,
  formatScoutDataImpactMetric,
  formatScoutDataImpactRate,
  isScoutDataImpactEmpty,
  scoutDataImpactNextActions,
  scoutDataImpactRelatedLinks,
  scoutDataImpactSetupSteps,
  scoutDataImpactShellCopy,
  shouldShowScoutDataImpactSummaryTiles,
} from "./scout-data-impact-related";

describe("scoutDataImpactRelatedLinks", () => {
  it("builds Scouting / Strategy / Accuracy via hubHref / withOrgHref", () => {
    const links = scoutDataImpactRelatedLinks("org-1", {
      include: [...SCOUT_DATA_IMPACT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "strategy", "accuracy"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "accuracy")?.href).toBe("/scout-accuracy?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scoutDataImpactRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("scoutDataImpactSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO credit", () => {
    const steps = scoutDataImpactSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Scout Data Impact Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatScoutDataImpactMetric(3, true)).toBe("3");
    expect(formatScoutDataImpactMetric(0, false)).toBe("…");
    expect(formatScoutDataImpactMetric(-1, true)).toBe("0");
  });

  it("formats rates without inventing DEMO %", () => {
    expect(formatScoutDataImpactRate(0.5, true)).toBe("50%");
    expect(formatScoutDataImpactRate(0, false)).toBe("…");
    expect(formatScoutDataImpactRate(null, true)).toBe("—");
    expect(formatScoutDataImpactRate(0, true, { hasPicks: false })).toBe("—");
  });

  it("hides summary tiles without picks or entries", () => {
    expect(shouldShowScoutDataImpactSummaryTiles({ pickCount: 0, totalEntries: 0 })).toBe(false);
    expect(shouldShowScoutDataImpactSummaryTiles({ pickCount: 1, totalEntries: 0 })).toBe(true);
  });

  it("classifies empty vs ready without DEMO credit", () => {
    expect(isScoutDataImpactEmpty({ pickCount: 0 })).toBe(true);
    expect(classifyScoutDataImpactShell({ status: "live", orgId: "o", pickCount: 0 })).toBe(
      "empty",
    );
    expect(classifyScoutDataImpactShell({ status: "live", orgId: "o", pickCount: 2 })).toBe(
      "ready",
    );
    expect(scoutDataImpactShellCopy("empty").title).not.toMatch(/\bDEMO\b/);
    expect(scoutDataImpactShellCopy("empty").description).toMatch(/never DEMO/i);
  });

  it("next actions point at real hubs", () => {
    const actions = scoutDataImpactNextActions({
      orgId: "org-1",
      shell: "empty",
    });
    expect(actions[0]?.href).toBe("#log-alliance-pick");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });
});
