import { describe, expect, it } from "vitest";
import {
  MATCH_STRATEGY_CARDS_RELATED_INCLUDE,
  classifyMatchStrategyCardsShell,
  formatMatchStrategyCardsMetric,
  matchStrategyCardsNextActions,
  matchStrategyCardsRelatedLinks,
  matchStrategyCardsShellCopy,
  shouldShowMatchStrategyCardsSummaryTiles,
} from "./match-strategy-cards-related";

describe("matchStrategyCardsRelatedLinks", () => {
  it("builds Strategy / Checklist / Command cross-links", () => {
    const links = matchStrategyCardsRelatedLinks("org-1", {
      include: [...MATCH_STRATEGY_CARDS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "match-checklist", "command"]);
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    expect(JSON.stringify(matchStrategyCardsRelatedLinks("org-1"))).not.toMatch(/DEMO/i);
  });
});

describe("matchStrategyCardsNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = matchStrategyCardsNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("points empty schedules at strategy sync", () => {
    const actions = matchStrategyCardsNextActions({
      orgId: "org-1",
      shell: "empty",
      cardCount: 0,
    });
    expect(actions[0]?.id).toBe("strategy");
  });

  it("ready boards prioritize drafting without DEMO plans", () => {
    const actions = matchStrategyCardsNextActions({
      orgId: "org-1",
      shell: "ready",
      cardCount: 4,
      savedCount: 1,
    });
    expect(actions[0]?.id).toBe("edit");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("prioritizes auto coordination when TBA partners have no auto plan", () => {
    const actions = matchStrategyCardsNextActions({
      orgId: "org-1",
      shell: "ready",
      cardCount: 4,
      savedCount: 1,
      needsAutoCoordination: true,
    });
    expect(actions[0]?.id).toBe("auto-coord");
    expect(actions[0]?.primary).toBe(true);
  });
});

describe("classifyMatchStrategyCardsShell", () => {
  it("classifies shells", () => {
    expect(classifyMatchStrategyCardsShell({ loading: true })).toBe("loading");
    expect(classifyMatchStrategyCardsShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(
      classifyMatchStrategyCardsShell({ status: "live", orgId: "o", cardCount: 0 }),
    ).toBe("empty");
    expect(
      classifyMatchStrategyCardsShell({ status: "live", orgId: "o", cardCount: 2 }),
    ).toBe("ready");
  });
});

describe("formatMatchStrategyCardsMetric", () => {
  it("formats real counts only", () => {
    expect(formatMatchStrategyCardsMetric(2, true)).toBe("2");
    expect(formatMatchStrategyCardsMetric(null, false)).toBe("…");
    expect(shouldShowMatchStrategyCardsSummaryTiles(0)).toBe(false);
  });
});

describe("matchStrategyCardsShellCopy", () => {
  it("never invents DEMO game plans", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = matchStrategyCardsShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(/never DEMO/i);
    }
  });
});
