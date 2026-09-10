import { describe, expect, it } from "vitest";
import {
  ROBOT_WEIGH_IN_RELATED_INCLUDE,
  classifyRobotWeighInShell,
  formatRobotWeighInMetric,
  robotWeighInNextActions,
  robotWeighInRelatedLinks,
  robotWeighInShellCopy,
  shouldShowRobotWeighInSummaryTiles,
} from "./robot-weigh-in-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("robotWeighInRelatedLinks", () => {
  it("builds Readiness / Inspection / Spare Kit cross-links", () => {
    const links = robotWeighInRelatedLinks("org-1", {
      include: [...ROBOT_WEIGH_IN_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["readiness-score", "inspection-copilot", "spare-robot-kit"]);
    expect(links.find((l) => l.id === "readiness-score")?.href).toBe(
      "/build?tab=readiness-score&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(robotWeighInRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("robotWeighInNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = robotWeighInNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "readiness")).toBe(true);
  });

  it("points empty boards at log-weigh-in", () => {
    const actions = robotWeighInNextActions({
      orgId: "org-1",
      shell: "empty",
      entryCount: 0,
    });
    expect(actions[0]?.id).toBe("log-weigh-in");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize over-limit without DEMO metrics", () => {
    const actions = robotWeighInNextActions({
      orgId: "org-1",
      shell: "ready",
      entryCount: 4,
      overLimitCount: 1,
    });
    expect(actions[0]?.id).toBe("over-limit");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("prioritizes playoff re-weigh when TBA elims are unplayed", () => {
    const actions = robotWeighInNextActions({
      orgId: "org-1",
      shell: "ready",
      entryCount: 4,
      overLimitCount: 1,
      playoffReweighCue:
        "Playoffs are on the schedule. Log an Event inspection weigh-in after alliance selection — weight stays blank until you step on the scale.",
    });
    expect(actions[0]?.id).toBe("playoff-reweigh");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyRobotWeighInShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyRobotWeighInShell({ loading: true })).toBe("loading");
    expect(classifyRobotWeighInShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyRobotWeighInShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyRobotWeighInShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        entryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyRobotWeighInShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        entryCount: 3,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatRobotWeighInMetric(4, true)).toBe("4");
    expect(shouldShowRobotWeighInSummaryTiles(0)).toBe(false);
    expect(shouldShowRobotWeighInSummaryTiles(1)).toBe(true);
  });

  it("copy never invents DEMO weigh-ins", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = robotWeighInShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
