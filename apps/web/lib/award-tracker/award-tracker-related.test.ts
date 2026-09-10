import { describe, expect, it } from "vitest";
import {
  AWARD_TRACKER_RELATED_INCLUDE,
  classifyAwardTrackerShell,
  formatAwardTrackerMetric,
  formatAwardTrackerProgress,
  awardTrackerNextActions,
  awardTrackerRelatedLinks,
  awardTrackerShellCopy,
  shouldShowAwardTrackerSummaryTiles,
} from "./award-tracker-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("awardTrackerRelatedLinks", () => {
  it("builds Awards / Awards workbench / Impact essay cross-links", () => {
    const links = awardTrackerRelatedLinks("org-1", {
      include: [...AWARD_TRACKER_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["evidence", "awards-workbench", "impact-essay"]);
    expect(links.find((l) => l.id === "evidence")?.href).toBe("/business?tab=evidence&orgId=org-1");
    expect(links.find((l) => l.id === "awards-workbench")?.href).toBe("/team/awards?orgId=org-1");
    expect(links.find((l) => l.id === "impact-essay")?.href).toBe(
      "/business?tab=impact-essay&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = awardTrackerRelatedLinks("org-1", {
      active: "evidence",
      include: ["awards-workbench", "impact-essay"],
    });
    expect(links.map((l) => l.id)).toEqual(["awards-workbench", "impact-essay"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(awardTrackerRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("awardTrackerNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = awardTrackerNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "evidence")).toBe(true);
    expect(actions.some((a) => a.id === "impact-essay")).toBe(true);
  });

  it("setup with org points at Workspace + Awards / Essay", () => {
    const actions = awardTrackerNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "evidence")).toBe(true);
    expect(actions.some((a) => a.id === "impact-essay")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty shells at track + Awards / Essay", () => {
    const actions = awardTrackerNextActions({
      orgId: "org-1",
      shell: "empty",
      submissionCount: 0,
    });
    expect(actions[0]?.id).toBe("track");
    expect(actions[0]?.href).toBe("#award-tracker-create");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["track", "evidence", "impact-essay"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready shells prioritize track-more without DEMO metrics", () => {
    const actions = awardTrackerNextActions({
      orgId: "org-1",
      shell: "ready",
      submissionCount: 3,
      dueSoonCount: 1,
    });
    expect(actions[0]?.id).toBe("track-more");
    expect(actions.some((a) => a.id === "evidence")).toBe(true);
    expect(actions.some((a) => a.id === "impact-essay")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyAwardTrackerShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyAwardTrackerShell({ loading: true })).toBe("loading");
    expect(classifyAwardTrackerShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyAwardTrackerShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyAwardTrackerShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyAwardTrackerShell({
        loading: false,
        orgId: "o1",
        status: "live",
        submissionCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyAwardTrackerShell({
        loading: false,
        orgId: "o1",
        status: "live",
        submissionCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("awardTrackerShellCopy + format helpers", () => {
  it("refuses invented DEMO win rates in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = awardTrackerShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(awardTrackerShellCopy("empty").description);
    expectPlainCopy(awardTrackerShellCopy("setup").description);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatAwardTrackerMetric(null, false)).toBe("…");
    expect(formatAwardTrackerMetric(3, true)).toBe("3");
    expect(formatAwardTrackerProgress(0.5, 0, true)).toBe("—");
    expect(formatAwardTrackerProgress(0.5, 2, true)).toBe("50%");
    expect(shouldShowAwardTrackerSummaryTiles(0)).toBe(false);
    expect(shouldShowAwardTrackerSummaryTiles(1)).toBe(true);
  });
});
