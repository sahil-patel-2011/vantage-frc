import { describe, expect, it } from "vitest";
import {
  DECISION_SEARCH_RELATED_INCLUDE,
  classifyDecisionSearchShell,
  decisionSearchNextActions,
  decisionSearchRelatedLinks,
  decisionSearchShellCopy,
  formatDecisionSearchMatchPct,
  formatDecisionSearchMetric,
} from "./decision-search-related";

describe("decisionSearchRelatedLinks", () => {
  it("builds Season Report / Knowledge / Strategy cross-links", () => {
    const links = decisionSearchRelatedLinks("org-1", { include: [...DECISION_SEARCH_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["season-report", "knowledge", "strategy"]);
    expect(links.find((l) => l.id === "season-report")?.href).toBe(
      "/ai?tab=season-report&orgId=org-1",
    );
    expect(links.find((l) => l.id === "knowledge")?.href).toBe("/team?tab=knowledge&orgId=org-1");
    expect(links.find((l) => l.id === "strategy")?.href).toBe("/strategy?orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = decisionSearchRelatedLinks("org-1", {
      active: "strategy",
      include: ["season-report", "knowledge"],
    });
    expect(links.map((l) => l.id)).toEqual(["season-report", "knowledge"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(decisionSearchRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("decisionSearchNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = decisionSearchNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "season-report")).toBe(true);
    expect(actions.some((a) => a.id === "knowledge")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
  });

  it("setup with org points at Workspace + Season Report / Knowledge / Strategy", () => {
    const actions = decisionSearchNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "season-report")).toBe(true);
    expect(actions.some((a) => a.id === "knowledge")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at index + Season Report / Knowledge", () => {
    const actions = decisionSearchNextActions({
      orgId: "org-1",
      shell: "empty",
      documentCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["index", "season-report", "knowledge"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize Season Report / Knowledge / Strategy without DEMO decisions", () => {
    const actions = decisionSearchNextActions({
      orgId: "org-1",
      shell: "ready",
      documentCount: 4,
      queryCount: 1,
    });
    expect(actions.some((a) => a.id === "season-report")).toBe(true);
    expect(actions.some((a) => a.id === "knowledge")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});

describe("classifyDecisionSearchShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO decisions", () => {
    expect(classifyDecisionSearchShell({ loading: true })).toBe("loading");
    expect(classifyDecisionSearchShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyDecisionSearchShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyDecisionSearchShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyDecisionSearchShell({
        loading: false,
        orgId: "o1",
        status: "live",
        documentCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyDecisionSearchShell({
        loading: false,
        orgId: "o1",
        status: "live",
        documentCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("decisionSearchShellCopy + metrics", () => {
  it("refuses invented DEMO decisions in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = decisionSearchShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|indexed|metered/i);
    }
    expect(decisionSearchShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(decisionSearchShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats metrics from real counts only", () => {
    expect(formatDecisionSearchMetric(undefined, false)).toBe("…");
    expect(formatDecisionSearchMetric(3, true)).toBe("3");
    expect(formatDecisionSearchMetric(-1, true)).toBe("0");
    expect(formatDecisionSearchMatchPct(0.42, true)).toBe("42%");
    expect(formatDecisionSearchMatchPct(null, false)).toBe("…");
  });
});
