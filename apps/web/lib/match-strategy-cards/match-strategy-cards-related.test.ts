import { describe, expect, it } from "vitest";
import {
  MATCH_STRATEGY_CARDS_RELATED_INCLUDE,
  classifyMatchStrategyCardsShell,
  formatMatchStrategyCardsMetric,
  matchStrategyCardsNextActions,
  matchStrategyCardsRelatedLinks,
  matchStrategyCardsSetupSteps,
  matchStrategyCardsShellCopy,
  shouldShowMatchStrategyCardsSummaryTiles,
} from "./match-strategy-cards-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("matchStrategyCardsRelatedLinks", () => {
  it("builds Strategy / Checklist / Command cross-links", () => {
    const links = matchStrategyCardsRelatedLinks("org-1", {
      include: [...MATCH_STRATEGY_CARDS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "match-checklist", "command", "briefing"]);
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    expect(JSON.stringify(matchStrategyCardsRelatedLinks("org-1"))).not.toMatch(/DEMO/i);
  });
});

describe("matchStrategyCardsSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    expect(matchStrategyCardsSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });

  it("keeps Sync Team Data; Strategy / Checklist / Command live on the related strip", () => {
    const steps = matchStrategyCardsSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["team-data"]);
    expect(steps[0]?.href).toBe("/team/data?orgId=org-1");
  });
});

describe("matchStrategyCardsNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = matchStrategyCardsNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("setup with org is only Sync Team Data", () => {
    const actions = matchStrategyCardsNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["team-data"]);
    expect(actions[0]?.href).toBe("/team/data?orgId=org-1");
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

  it("prioritizes a backup auto when Auto is filled without flex language", () => {
    const actions = matchStrategyCardsNextActions({
      orgId: "org-1",
      shell: "ready",
      cardCount: 4,
      savedCount: 1,
      needsAutoFlexibility: true,
    });
    expect(actions[0]?.id).toBe("auto-flex");
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
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
