import { describe, expect, it } from "vitest";
import {
  EPA_TREND_ALERTS_RELATED_INCLUDE,
  classifyEpaTrendAlertsShell,
  epaTrendAlertsNextActions,
  epaTrendAlertsRelatedLinks,
  epaTrendAlertsShellCopy,
  formatEpaTrendMetric,
  shouldShowEpaTrendSummaryTiles,
} from "./epa-trend-alerts-related";

describe("epaTrendAlertsRelatedLinks", () => {
  it("builds Strategy / Opponent Watchlist cross-links", () => {
    const links = epaTrendAlertsRelatedLinks("org-1", {
      include: [...EPA_TREND_ALERTS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "opponent-watchlist"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "opponent-watchlist")?.href).toBe(
      "/competition?tab=opponent-watchlist&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = epaTrendAlertsRelatedLinks("org-1", {
      active: "strategy",
      include: ["opponent-watchlist", "counter-book"],
    });
    expect(links.map((l) => l.id)).toEqual(["opponent-watchlist", "counter-book"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(epaTrendAlertsRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("epaTrendAlertsNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = epaTrendAlertsNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "opponent-watchlist")).toBe(true);
  });

  it("setup with org points at Workspace + Strategy / Opponent Watchlist", () => {
    const actions = epaTrendAlertsNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "opponent-watchlist")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at watch-team + Strategy / Opponent Watchlist", () => {
    const actions = epaTrendAlertsNextActions({
      orgId: "org-1",
      shell: "empty",
      watchlistCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["watch-team", "strategy", "opponent-watchlist"]),
    );
    expect(actions[0]?.href).toBe("#epa-trend-alerts-watch");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize alerts without DEMO metrics", () => {
    const actions = epaTrendAlertsNextActions({
      orgId: "org-1",
      shell: "ready",
      watchlistCount: 2,
      alertCount: 1,
    });
    expect(actions[0]?.id).toBe("review-alerts");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "opponent-watchlist")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyEpaTrendAlertsShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyEpaTrendAlertsShell({ loading: true })).toBe("loading");
    expect(classifyEpaTrendAlertsShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyEpaTrendAlertsShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyEpaTrendAlertsShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyEpaTrendAlertsShell({
        loading: false,
        orgId: "o1",
        status: "live",
        watchlistCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyEpaTrendAlertsShell({
        loading: false,
        orgId: "o1",
        status: "live",
        watchlistCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("epaTrendAlertsShellCopy + format helpers", () => {
  it("refuses invented DEMO EPA metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = epaTrendAlertsShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent|watch|reference/i);
    }
    expect(epaTrendAlertsShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(epaTrendAlertsShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatEpaTrendMetric(null, false)).toBe("…");
    expect(formatEpaTrendMetric(3, true)).toBe("3");
    expect(formatEpaTrendMetric(-1, true)).toBe("0");
    expect(shouldShowEpaTrendSummaryTiles(0)).toBe(false);
    expect(shouldShowEpaTrendSummaryTiles(2)).toBe(true);
  });
});
