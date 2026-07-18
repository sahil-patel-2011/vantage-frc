import { describe, expect, it } from "vitest";
import {
  OPPONENT_WATCHLIST_RELATED_INCLUDE,
  classifyOpponentWatchlistShell,
  formatOpponentWatchlistMetric,
  opponentWatchlistNextActions,
  opponentWatchlistRelatedLinks,
  opponentWatchlistShellCopy,
  shouldShowOpponentWatchlistSummaryTiles,
} from "./opponent-watchlist-related";

describe("opponentWatchlistRelatedLinks", () => {
  it("builds Strategy / EPA Trend Alerts / Scouting cross-links", () => {
    const links = opponentWatchlistRelatedLinks("org-1", {
      include: [...OPPONENT_WATCHLIST_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "epa-trend-alerts", "scouting"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "epa-trend-alerts")?.href).toBe(
      "/competition?tab=epa-trend-alerts&orgId=org-1",
    );
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = opponentWatchlistRelatedLinks("org-1", {
      active: "strategy",
      include: ["epa-trend-alerts", "counter-book"],
    });
    expect(links.map((l) => l.id)).toEqual(["epa-trend-alerts", "counter-book"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(opponentWatchlistRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("opponentWatchlistNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = opponentWatchlistNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "epa-trend-alerts")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
  });

  it("setup with org points at Workspace + Strategy / EPA alerts / Scouting", () => {
    const actions = opponentWatchlistNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "epa-trend-alerts")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at watch-team + Strategy / EPA alerts / Scouting", () => {
    const actions = opponentWatchlistNextActions({
      orgId: "org-1",
      shell: "empty",
      entryCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["watch-team", "strategy", "epa-trend-alerts", "scouting"]),
    );
    expect(actions[0]?.href).toBe("#opponent-watchlist-watch");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize alerts without DEMO metrics", () => {
    const actions = opponentWatchlistNextActions({
      orgId: "org-1",
      shell: "ready",
      entryCount: 2,
      alertCount: 1,
    });
    expect(actions[0]?.id).toBe("review-alerts");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "epa-trend-alerts")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyOpponentWatchlistShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyOpponentWatchlistShell({ loading: true })).toBe("loading");
    expect(classifyOpponentWatchlistShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyOpponentWatchlistShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyOpponentWatchlistShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyOpponentWatchlistShell({
        loading: false,
        orgId: "o1",
        status: "live",
        entryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyOpponentWatchlistShell({
        loading: false,
        orgId: "o1",
        status: "live",
        entryCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("opponentWatchlistShellCopy + format helpers", () => {
  it("refuses invented DEMO opponent metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = opponentWatchlistShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent|watch|reference/i);
    }
    expect(opponentWatchlistShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(opponentWatchlistShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatOpponentWatchlistMetric(null, false)).toBe("…");
    expect(formatOpponentWatchlistMetric(3, true)).toBe("3");
    expect(formatOpponentWatchlistMetric(-1, true)).toBe("0");
    expect(shouldShowOpponentWatchlistSummaryTiles(0)).toBe(false);
    expect(shouldShowOpponentWatchlistSummaryTiles(2)).toBe(true);
  });
});
