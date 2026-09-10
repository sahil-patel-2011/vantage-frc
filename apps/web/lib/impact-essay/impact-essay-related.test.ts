import { describe, expect, it } from "vitest";
import {
  IMPACT_ESSAY_RELATED_INCLUDE,
  classifyImpactEssayShell,
  formatImpactEssayHours,
  formatImpactEssayMetric,
  impactEssayNextActions,
  impactEssayRelatedLinks,
  impactEssayShellCopy,
  shouldShowImpactEssaySummaryTiles,
} from "./impact-essay-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("impactEssayRelatedLinks", () => {
  it("builds Community Impact / Awards / Writer cross-links", () => {
    const links = impactEssayRelatedLinks("org-1", {
      include: [...IMPACT_ESSAY_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["impact", "evidence", "writer"]);
    expect(links.find((l) => l.id === "impact")?.href).toBe("/business?tab=impact&orgId=org-1");
    expect(links.find((l) => l.id === "evidence")?.href).toBe("/business?tab=evidence&orgId=org-1");
    expect(links.find((l) => l.id === "writer")?.href).toBe("/ai?tab=writer&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = impactEssayRelatedLinks("org-1", {
      active: "impact",
      include: ["evidence", "writer"],
    });
    expect(links.map((l) => l.id)).toEqual(["evidence", "writer"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(impactEssayRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("impactEssayNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = impactEssayNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.some((a) => a.id === "evidence")).toBe(true);
    expect(actions.some((a) => a.id === "writer")).toBe(true);
  });

  it("setup with org points at Workspace + Impact / Awards / Writer", () => {
    const actions = impactEssayNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.some((a) => a.id === "evidence")).toBe(true);
    expect(actions.some((a) => a.id === "writer")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty shells at Impact / Awards / Writer", () => {
    const actions = impactEssayNextActions({
      orgId: "org-1",
      shell: "empty",
      hasGroundedData: false,
    });
    expect(actions[0]?.id).toBe("impact");
    expect(actions[0]?.href).toBe("/business?tab=impact&orgId=org-1");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["impact", "evidence", "writer"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready shells prioritize generate without DEMO metrics", () => {
    const actions = impactEssayNextActions({
      orgId: "org-1",
      shell: "ready",
      hasGroundedData: true,
      draftCount: 2,
      outreachCount: 3,
    });
    expect(actions[0]?.id).toBe("generate");
    expect(actions.some((a) => a.id === "review-drafts")).toBe(true);
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.some((a) => a.id === "evidence")).toBe(true);
    expect(actions.some((a) => a.id === "writer")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyImpactEssayShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyImpactEssayShell({ loading: true })).toBe("loading");
    expect(classifyImpactEssayShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyImpactEssayShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyImpactEssayShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyImpactEssayShell({
        loading: false,
        orgId: "o1",
        status: "live",
        hasGroundedData: false,
      }),
    ).toBe("empty");
    expect(
      classifyImpactEssayShell({
        loading: false,
        orgId: "o1",
        status: "live",
        hasGroundedData: true,
      }),
    ).toBe("ready");
  });
});

describe("impactEssayShellCopy + format helpers", () => {
  it("refuses invented DEMO essay metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = impactEssayShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(impactEssayShellCopy("empty").description);
    expectPlainCopy(impactEssayShellCopy("setup").description);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatImpactEssayMetric(null, false)).toBe("…");
    expect(formatImpactEssayMetric(3, true)).toBe("3");
    expect(formatImpactEssayMetric(-1, true)).toBe("0");
    expect(formatImpactEssayHours(42.5, true)).toBe("42.5");
    expect(formatImpactEssayHours(0, true)).toBe("0");
    expect(shouldShowImpactEssaySummaryTiles(false)).toBe(false);
    expect(shouldShowImpactEssaySummaryTiles(true)).toBe(true);
  });
});
