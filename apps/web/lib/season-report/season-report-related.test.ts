import { describe, expect, it } from "vitest";
import {
  SEASON_REPORT_RELATED_INCLUDE,
  classifySeasonReportShell,
  formatSeasonReportCompleteness,
  formatSeasonReportMetric,
  seasonReportNextActions,
  seasonReportRelatedLinks,
  seasonReportShellCopy,
} from "./season-report-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("seasonReportRelatedLinks", () => {
  it("builds Strategy / Impact / Decision Search cross-links", () => {
    const links = seasonReportRelatedLinks("org-1", { include: [...SEASON_REPORT_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["strategy", "impact", "decision-search"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe("/strategy?orgId=org-1");
    expect(links.find((l) => l.id === "impact")?.href).toBe("/impact?orgId=org-1");
    expect(links.find((l) => l.id === "decision-search")?.href).toBe(
      "/ai?tab=decision-search&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = seasonReportRelatedLinks("org-1", {
      active: "strategy",
      include: ["impact", "decision-search"],
    });
    expect(links.map((l) => l.id)).toEqual(["impact", "decision-search"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(seasonReportRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("seasonReportNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = seasonReportNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "impact")).toBe(true);
  });

  it("setup with org points at Workspace + Strategy + Impact", () => {
    const actions = seasonReportNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at log + Strategy / Impact", () => {
    const actions = seasonReportNextActions({
      orgId: "org-1",
      shell: "empty",
      entryCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["log", "strategy", "impact"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize Strategy / Impact without DEMO stats", () => {
    const actions = seasonReportNextActions({
      orgId: "org-1",
      shell: "ready",
      entryCount: 4,
      snapshotCount: 1,
    });
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});

describe("classifySeasonReportShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO stats", () => {
    expect(classifySeasonReportShell({ loading: true })).toBe("loading");
    expect(classifySeasonReportShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifySeasonReportShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifySeasonReportShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifySeasonReportShell({
        loading: false,
        orgId: "o1",
        status: "live",
        entryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifySeasonReportShell({
        loading: false,
        orgId: "o1",
        status: "live",
        entryCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("seasonReportShellCopy + metrics", () => {
  it("refuses invented DEMO season stats in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = seasonReportShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(seasonReportShellCopy("empty").description);
    expectPlainCopy(seasonReportShellCopy("setup").description);
  });

  it("formats metrics from real counts only", () => {
    expect(formatSeasonReportMetric(undefined, false)).toBe("…");
    expect(formatSeasonReportMetric(3, true)).toBe("3");
    expect(formatSeasonReportMetric(-1, true)).toBe("0");
    expect(formatSeasonReportCompleteness(0.42, true)).toBe("42%");
    expect(formatSeasonReportCompleteness(null, false)).toBe("…");
  });
});
