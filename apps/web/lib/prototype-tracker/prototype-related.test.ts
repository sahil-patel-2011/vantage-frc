import { describe, expect, it } from "vitest";
import {
  PROTOTYPE_BUILD_RELATED_INCLUDE,
  decisionStatusLabel,
  formatMetricEvidence,
  outcomeBadgeTone,
  prototypeNextActions,
  prototypeStatusCounts,
  recommendationBadgeTone,
  shouldShowPrototypeSummaryTiles,
} from "./prototype-related";

describe("prototype Soft-UI helpers", () => {
  it("focuses Build links on FMEA + CAD + Kickoff", () => {
    expect(PROTOTYPE_BUILD_RELATED_INCLUDE).toEqual(["fmea", "cad", "kickoff"]);
  });

  it("asks for the first test when the tracker is empty — never DEMO metrics", () => {
    const actions = prototypeNextActions({
      orgId: "org-1",
      seasonYear: 2026,
      testCount: 0,
      decisionCount: 0,
      draftDecisionCount: 0,
      testsWithoutDecision: 0,
    });
    expect(actions[0]?.id).toBe("log-first");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "kickoff")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(actions[0]?.href).toBe("/build?tab=prototype&orgId=org-1");
  });

  it("prioritizes drafting decisions for tests that lack one", () => {
    const actions = prototypeNextActions({
      orgId: "org-1",
      seasonYear: 2026,
      testCount: 3,
      decisionCount: 1,
      draftDecisionCount: 0,
      testsWithoutDecision: 2,
    });
    expect(actions[0]?.id).toBe("draft-decision");
    expect(actions[0]?.detail).toMatch(/recorded outcome/i);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
  });

  it("prioritizes finalizing open drafts", () => {
    const actions = prototypeNextActions({
      orgId: "org-1",
      seasonYear: 2026,
      testCount: 2,
      decisionCount: 2,
      draftDecisionCount: 1,
      testsWithoutDecision: 0,
    });
    expect(actions[0]?.id).toBe("finalize");
  });

  it("requires workspace when org is missing", () => {
    expect(
      prototypeNextActions({
        seasonYear: 2026,
        testCount: 0,
        decisionCount: 0,
        draftDecisionCount: 0,
        testsWithoutDecision: 0,
      }).map((a) => a.id),
    ).toEqual(["workspace"]);
  });

  it("uses status tones that are not the DEMO badge for failures", () => {
    expect(outcomeBadgeTone("success")).toBe("good");
    expect(outcomeBadgeTone("partial")).toBe("setup");
    expect(outcomeBadgeTone("failure")).toBe("danger");
    expect(outcomeBadgeTone("inconclusive")).toBe("");
    expect(recommendationBadgeTone("adopt")).toBe("good");
    expect(recommendationBadgeTone("reject")).toBe("danger");
    expect(recommendationBadgeTone("needs_more_data")).toBe("");
    expect(decisionStatusLabel("draft")).toBe("Draft");
    expect(decisionStatusLabel("finalized")).toBe("Finalized");
  });

  it("formats metric evidence only from recorded fields", () => {
    expect(formatMetricEvidence({ metricLabel: null, metricValue: null, metricTarget: null })).toBeNull();
    expect(
      formatMetricEvidence({ metricLabel: "Hold time (s)", metricValue: 30, metricTarget: 20 }),
    ).toBe("Hold time (s): 30 (target 20)");
    expect(
      formatMetricEvidence({ metricLabel: "Cycles", metricValue: 12, metricTarget: null }),
    ).toBe("Cycles: 12");
  });

  it("hides summary tiles until tests exist — avoids DEMO counters", () => {
    expect(shouldShowPrototypeSummaryTiles({ testCount: 0 })).toBe(false);
    expect(shouldShowPrototypeSummaryTiles({ testCount: 1 })).toBe(true);
    expect(
      prototypeStatusCounts({
        testCount: 0,
        decisionCount: 0,
        draftDecisionCount: 0,
        successCount: 0,
      }),
    ).toEqual([]);
    const tiles = prototypeStatusCounts({
      testCount: 4,
      decisionCount: 2,
      draftDecisionCount: 1,
      successCount: 2,
    });
    expect(tiles.map((t) => t.id)).toEqual(["tests", "success", "decisions", "drafts"]);
    expect(tiles.every((t) => !/demo/i.test(t.label + t.value))).toBe(true);
  });
});
