import { describe, expect, it } from "vitest";
import {
  SCOUT_FIELD_BUDGET_RELATED_INCLUDE,
  classifyScoutFieldBudgetShell,
  formatScoutFieldBudgetMetric,
  scoutFieldBudgetNextActions,
  scoutFieldBudgetRelatedLinks,
  scoutFieldBudgetShellCopy,
  shouldShowScoutFieldBudgetSummaryTiles,
} from "./scout-field-budget-related";

describe("scoutFieldBudgetRelatedLinks", () => {
  it("builds Forms / Scouting / Schema A/B cross-links", () => {
    const links = scoutFieldBudgetRelatedLinks("org-1", {
      include: [...SCOUT_FIELD_BUDGET_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["forms", "scouting", "schema-ab"]);
    expect(links.find((l) => l.id === "forms")?.href).toBe("/competition?tab=forms&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scoutFieldBudgetRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("scoutFieldBudgetNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = scoutFieldBudgetNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "forms")).toBe(true);
  });

  it("points empty boards at lint + Forms", () => {
    const actions = scoutFieldBudgetNextActions({
      orgId: "org-1",
      shell: "empty",
      snapshotCount: 0,
    });
    expect(actions[0]?.href).toBe("#scout-field-budget-lint");
    expect(actions.some((a) => a.id === "forms")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize over-budget schemas without DEMO metrics", () => {
    const actions = scoutFieldBudgetNextActions({
      orgId: "org-1",
      shell: "ready",
      snapshotCount: 4,
      overBudgetCount: 2,
    });
    expect(actions[0]?.id).toBe("trim-over-budget");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyScoutFieldBudgetShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyScoutFieldBudgetShell({ loading: true })).toBe("loading");
    expect(classifyScoutFieldBudgetShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyScoutFieldBudgetShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyScoutFieldBudgetShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        snapshotCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyScoutFieldBudgetShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        snapshotCount: 3,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatScoutFieldBudgetMetric(4, true)).toBe("4");
    expect(shouldShowScoutFieldBudgetSummaryTiles(0)).toBe(false);
    expect(shouldShowScoutFieldBudgetSummaryTiles(1)).toBe(true);
  });

  it("copy never invents DEMO field totals", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = scoutFieldBudgetShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
