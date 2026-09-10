import { describe, expect, it } from "vitest";
import {
  MATCH_VIDEO_INDEX_RELATED_INCLUDE,
  classifyMatchVideoIndexShell,
  formatMatchVideoIndexMetric,
  matchVideoIndexNextActions,
  matchVideoIndexRelatedLinks,
  matchVideoIndexSetupSteps,
  matchVideoIndexShellCopy,
  shouldShowMatchVideoIndexSummaryTiles,
} from "./match-video-index-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("matchVideoIndexRelatedLinks", () => {
  it("builds Scouting / Match Notes / Match-Delta cross-links", () => {
    const links = matchVideoIndexRelatedLinks("org-1", {
      include: [...MATCH_VIDEO_INDEX_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "match-notes-timeline", "match-delta-watcher"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe("/competition?tab=scouting&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(matchVideoIndexRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("matchVideoIndexSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    expect(matchVideoIndexSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });

  it("keeps Set active event; Scouting / Notes / Match-Delta live on the related strip", () => {
    const steps = matchVideoIndexSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["command"]);
    expect(steps[0]?.href).toBe("/competition?tab=command&orgId=org-1");
  });
});

describe("matchVideoIndexNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = matchVideoIndexNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("points empty boards at add-video", () => {
    const actions = matchVideoIndexNextActions({ orgId: "org-1", shell: "empty", videoCount: 0 });
    expect(actions[0]?.id).toBe("add-video");
  });

  it("ready boards prioritize review without DEMO", () => {
    const actions = matchVideoIndexNextActions({ orgId: "org-1", shell: "ready", videoCount: 3 });
    expect(actions[0]?.id).toBe("review-clips");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyMatchVideoIndexShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyMatchVideoIndexShell({ loading: true })).toBe("loading");
    expect(classifyMatchVideoIndexShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyMatchVideoIndexShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyMatchVideoIndexShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        videoCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyMatchVideoIndexShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        videoCount: 2,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatMatchVideoIndexMetric(4, true)).toBe("4");
    expect(shouldShowMatchVideoIndexSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowMatchVideoIndexSummaryTiles(1, 0)).toBe(true);
  });

  it("copy never invents DEMO clip packs", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = matchVideoIndexShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
