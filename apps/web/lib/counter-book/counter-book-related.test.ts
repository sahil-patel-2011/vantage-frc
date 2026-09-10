import { describe, expect, it } from "vitest";
import {
  COUNTER_BOOK_RELATED_INCLUDE,
  classifyCounterBookShell,
  counterBookNextActions,
  counterBookRelatedLinks,
  counterBookShellCopy,
  formatCounterBookMetric,
  shouldShowCounterBookSummaryTiles,
} from "./counter-book-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("counterBookRelatedLinks", () => {
  it("builds Strategy / Scouting cross-links", () => {
    const links = counterBookRelatedLinks("org-1", {
      include: [...COUNTER_BOOK_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "scouting"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = counterBookRelatedLinks("org-1", {
      active: "strategy",
      include: ["scouting", "opponent-watchlist"],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "opponent-watchlist"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(counterBookRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("counterBookNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = counterBookNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
  });

  it("setup with org points at Workspace + Strategy / Scouting", () => {
    const actions = counterBookNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at generate + Scouting / Strategy", () => {
    const actions = counterBookNextActions({
      orgId: "org-1",
      shell: "empty",
      reportCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["generate", "scouting", "strategy"]),
    );
    expect(actions[0]?.href).toBe("#counter-book-generate");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize another generate without DEMO metrics", () => {
    const actions = counterBookNextActions({
      orgId: "org-1",
      shell: "ready",
      reportCount: 2,
    });
    expect(actions[0]?.id).toBe("generate-another");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyCounterBookShell + copy", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyCounterBookShell({ loading: true })).toBe("loading");
    expect(classifyCounterBookShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(classifyCounterBookShell({ loading: false, status: "setup_required", orgId: null })).toBe(
      "setup",
    );
    expect(
      classifyCounterBookShell({ loading: false, status: "live", orgId: "org-1", reportCount: 0 }),
    ).toBe("empty");
    expect(
      classifyCounterBookShell({ loading: false, status: "live", orgId: "org-1", reportCount: 1 }),
    ).toBe("ready");
  });

  it("copy never invents DEMO opponent metrics", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = counterBookShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
      expect(`${copy.title} ${copy.description}`.toLowerCase()).not.toMatch(/\binvented demo\b/);
    }
  });
});

describe("formatCounterBookMetric", () => {
  it("formats real counts only", () => {
    expect(formatCounterBookMetric(null, false)).toBe("…");
    expect(formatCounterBookMetric(3, true)).toBe("3");
    expect(formatCounterBookMetric(-1, true)).toBe("0");
  });

  it("hides zero summary tiles", () => {
    expect(shouldShowCounterBookSummaryTiles(0)).toBe(false);
    expect(shouldShowCounterBookSummaryTiles(2)).toBe(true);
  });
});
