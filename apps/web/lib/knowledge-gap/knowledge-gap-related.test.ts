import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_GAP_RELATED_INCLUDE,
  classifyKnowledgeGapShell,
  formatKnowledgeGapMetric,
  knowledgeGapNextActions,
  knowledgeGapRelatedLinks,
  knowledgeGapShellCopy,
  shouldShowKnowledgeGapSummaryTiles,
} from "./knowledge-gap-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("knowledgeGapRelatedLinks", () => {
  it("builds Knowledge / Work / Meeting Autopilot cross-links", () => {
    const links = knowledgeGapRelatedLinks("org-1", {
      include: [...KNOWLEDGE_GAP_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["knowledge", "todos", "meeting-autopilot"]);
    expect(links.find((l) => l.id === "knowledge")?.href).toBe("/team?tab=knowledge&orgId=org-1");
    expect(links.find((l) => l.id === "todos")?.href).toBe("/team?tab=todos&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(knowledgeGapRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("knowledgeGapNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = knowledgeGapNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("points empty boards at run-scan", () => {
    const actions = knowledgeGapNextActions({
      orgId: "org-1",
      shell: "empty",
      hasScan: false,
      itemCount: 0,
    });
    expect(actions[0]?.id).toBe("run-scan");
  });

  it("ready boards prioritize stubs without DEMO", () => {
    const actions = knowledgeGapNextActions({
      orgId: "org-1",
      shell: "ready",
      hasScan: true,
      itemCount: 2,
    });
    expect(actions[0]?.id).toBe("draft-stubs");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyKnowledgeGapShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyKnowledgeGapShell({ loading: true })).toBe("loading");
    expect(classifyKnowledgeGapShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyKnowledgeGapShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyKnowledgeGapShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        hasScan: false,
      }),
    ).toBe("empty");
    expect(
      classifyKnowledgeGapShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        hasScan: true,
        itemCount: 0,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatKnowledgeGapMetric(3, true)).toBe("3");
    expect(shouldShowKnowledgeGapSummaryTiles(0, false)).toBe(false);
    expect(shouldShowKnowledgeGapSummaryTiles(0, true)).toBe(true);
  });

  it("copy never invents DEMO gap packs", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = knowledgeGapShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
