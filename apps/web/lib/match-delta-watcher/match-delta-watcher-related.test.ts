import { describe, expect, it } from "vitest";
import {
  MATCH_DELTA_WATCHER_RELATED_INCLUDE,
  classifyMatchDeltaWatcherShell,
  formatMatchDeltaWatcherMetric,
  formatMatchDeltaWatcherRate,
  matchDeltaWatcherNextActions,
  matchDeltaWatcherRelatedLinks,
  matchDeltaWatcherShellCopy,
  shouldShowMatchDeltaWatcherSummaryTiles,
} from "./match-delta-watcher-related";

describe("matchDeltaWatcherRelatedLinks", () => {
  it("builds Strategy / Pick List / Command cross-links", () => {
    const links = matchDeltaWatcherRelatedLinks("org-1", {
      include: [...MATCH_DELTA_WATCHER_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "picklist-collab", "command"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(matchDeltaWatcherRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("matchDeltaWatcherNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = matchDeltaWatcherNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
  });

  it("points empty boards at Strategy + Command", () => {
    const actions = matchDeltaWatcherNextActions({
      orgId: "org-1",
      shell: "empty",
      watchedCount: 0,
    });
    expect(actions[0]?.id).toBe("strategy");
    expect(actions.some((a) => a.id === "command")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize unacknowledged alerts without DEMO metrics", () => {
    const actions = matchDeltaWatcherNextActions({
      orgId: "org-1",
      shell: "ready",
      watchedCount: 4,
      unacknowledgedCount: 2,
    });
    expect(actions[0]?.id).toBe("ack-alerts");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyMatchDeltaWatcherShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyMatchDeltaWatcherShell({ loading: true })).toBe("loading");
    expect(classifyMatchDeltaWatcherShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyMatchDeltaWatcherShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyMatchDeltaWatcherShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        watchedCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyMatchDeltaWatcherShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        watchedCount: 3,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatMatchDeltaWatcherMetric(4, true)).toBe("4");
    expect(formatMatchDeltaWatcherRate(0.82, true, { hasWatched: true })).toBe("82%");
    expect(formatMatchDeltaWatcherRate(0, true, { hasWatched: false })).toBe("—");
    expect(shouldShowMatchDeltaWatcherSummaryTiles(0)).toBe(false);
    expect(shouldShowMatchDeltaWatcherSummaryTiles(1)).toBe(true);
  });

  it("copy never invents DEMO upset alerts", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = matchDeltaWatcherShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
