import { describe, expect, it } from "vitest";
import {
  ALLIANCE_SELECTION_DESK_RELATED_INCLUDE,
  allianceSelectionDeskNextActions,
  allianceSelectionDeskRelatedLinks,
  allianceSelectionDeskShellCopy,
  classifyAllianceSelectionDeskShell,
  formatAllianceSelectionDeskMetric,
  shouldShowAllianceSelectionDeskSummaryTiles,
} from "./alliance-selection-desk-related";

describe("allianceSelectionDeskRelatedLinks", () => {
  it("builds Strategy / Pick list / Pick clock cross-links", () => {
    const links = allianceSelectionDeskRelatedLinks("org-1", {
      include: [...ALLIANCE_SELECTION_DESK_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "picklist-collab", "pick-clock"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(allianceSelectionDeskRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("allianceSelectionDeskNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = allianceSelectionDeskNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("points empty boards at create + pick list", () => {
    const actions = allianceSelectionDeskNextActions({ orgId: "org-1", shell: "empty" });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["create", "picklist-collab", "scouting"]),
    );
    expect(actions[0]?.href).toBe("#alliance-desk-create");
  });

  it("ready boards prioritize fills without DEMO metrics", () => {
    const actions = allianceSelectionDeskNextActions({
      orgId: "org-1",
      shell: "ready",
      filledSlots: 2,
      conflictCount: 0,
    });
    expect(actions[0]?.id).toBe("board");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyAllianceSelectionDeskShell", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyAllianceSelectionDeskShell({ loading: true })).toBe("loading");
    expect(classifyAllianceSelectionDeskShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyAllianceSelectionDeskShell({ status: "setup_required", orgId: null })).toBe(
      "setup",
    );
    expect(classifyAllianceSelectionDeskShell({ status: "empty", orgId: "o" })).toBe("empty");
    expect(classifyAllianceSelectionDeskShell({ status: "live", orgId: "o" })).toBe("ready");
  });
});

describe("formatAllianceSelectionDeskMetric", () => {
  it("formats real counts only", () => {
    expect(formatAllianceSelectionDeskMetric(3, true)).toBe("3");
    expect(formatAllianceSelectionDeskMetric(null, false)).toBe("…");
    expect(shouldShowAllianceSelectionDeskSummaryTiles(0)).toBe(false);
    expect(shouldShowAllianceSelectionDeskSummaryTiles(1)).toBe(true);
  });
});

describe("allianceSelectionDeskShellCopy", () => {
  it("explicitly rejects DEMO rankings in shell copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = allianceSelectionDeskShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(/never DEMO/i);
    }
  });
});
