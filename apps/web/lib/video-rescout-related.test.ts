import { describe, expect, it } from "vitest";
import {
  VIDEO_RESCOUT_RELATED_INCLUDE,
  classifyVideoRescoutShell,
  formatVideoRescoutMetric,
  isVideoRescoutQueueEmpty,
  shouldShowVideoRescoutSummaryTiles,
  videoRescoutNextActions,
  videoRescoutRelatedLinks,
  videoRescoutSetupSteps,
  videoRescoutShellCopy,
} from "./video-rescout-related";
import { expectPlainCopy } from "./ui/copy-assertions";

describe("videoRescoutRelatedLinks", () => {
  it("builds Scouting / Event Day via hubHref / withOrgHref", () => {
    const links = videoRescoutRelatedLinks("org-1", {
      include: [...VIDEO_RESCOUT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "command"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(videoRescoutRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("videoRescoutSetupSteps", () => {
  it("keeps Set active event; Scouting / Event Day live on the related strip", () => {
    const steps = videoRescoutSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["command"]);
    expect(steps[0]?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
  });

  it("no-org setup is only Choose your team", () => {
    expect(videoRescoutSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });
});

describe("Video Re-Scout Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatVideoRescoutMetric(3, true)).toBe("3");
    expect(formatVideoRescoutMetric(0, false)).toBe("…");
    expect(formatVideoRescoutMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without real reviews", () => {
    expect(shouldShowVideoRescoutSummaryTiles({ reviewCount: 0, scoreCount: 0 })).toBe(false);
    expect(shouldShowVideoRescoutSummaryTiles({ reviewCount: 1, scoreCount: 0 })).toBe(true);
    expect(shouldShowVideoRescoutSummaryTiles({ reviewCount: 0, scoreCount: 2 })).toBe(true);
  });

  it("treats zero reviews as empty", () => {
    expect(isVideoRescoutQueueEmpty({ reviewCount: 0 })).toBe(true);
    expect(isVideoRescoutQueueEmpty({ reviewCount: 2 })).toBe(false);
  });
});

describe("classifyVideoRescoutShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO jobs", () => {
    expect(classifyVideoRescoutShell({ loading: true })).toBe("loading");
    expect(classifyVideoRescoutShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyVideoRescoutShell({ status: "setup_required" })).toBe("setup");
    expect(classifyVideoRescoutShell({ orgId: null, status: "ready" })).toBe("setup");
    expect(
      classifyVideoRescoutShell({
        orgId: "o",
        status: "ready",
        reviewCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyVideoRescoutShell({
        orgId: "o",
        status: "ready",
        reviewCount: 3,
      }),
    ).toBe("ready");
  });
});

describe("videoRescoutShellCopy", () => {
  it("refuses invented DEMO jobs in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = videoRescoutShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expectPlainCopy(videoRescoutShellCopy("empty").description);
    expect(videoRescoutShellCopy("setup").badge).toBe("Needs setup");
  });
});

describe("videoRescoutNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = videoRescoutNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.primary).toBe(true);
  });

  it("setup with org points at Set active event", () => {
    const actions = videoRescoutNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["command"]);
    expect(actions[0]?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("empty shell points at create + Scouting / Accuracy / Disagreements", () => {
    const actions = videoRescoutNextActions({
      orgId: "org-1",
      shell: "empty",
      reviewCount: 0,
    });
    expect(actions[0]?.id).toBe("create");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["scouting", "accuracy", "disagreements"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready queues prioritize real reviews without DEMO jobs", () => {
    const actions = videoRescoutNextActions({
      orgId: "org-1",
      shell: "ready",
      reviewCount: 4,
      scoreCount: 2,
    });
    expect(actions[0]?.id).toBe("reviews");
    expect(actions[0]?.href).toBe("#video-timeline");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "accuracy")).toBe(true);
    expect(actions.some((a) => a.id === "disagreements")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    const scouting = actions.find((a) => a.id === "scouting");
    expect(scouting?.detail).not.toMatch(/membership-bound/i);
    expectPlainCopy(scouting?.detail);
  });
});
