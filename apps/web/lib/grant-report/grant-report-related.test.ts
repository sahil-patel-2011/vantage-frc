import { describe, expect, it } from "vitest";
import {
  GRANT_REPORT_RELATED_INCLUDE,
  classifyGrantReportShell,
  formatGrantReportMetric,
  formatGrantReportUsd,
  grantReportNextActions,
  grantReportRelatedLinks,
  grantReportShellCopy,
  shouldShowGrantReportSummaryTiles,
} from "./grant-report-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("grantReportRelatedLinks", () => {
  it("builds Grants / Grants workbench / Community Impact cross-links", () => {
    const links = grantReportRelatedLinks("org-1", {
      include: [...GRANT_REPORT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["grants", "grant-workbench", "impact"]);
    expect(links.find((l) => l.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
    expect(links.find((l) => l.id === "grant-workbench")?.href).toBe("/team/grants?orgId=org-1");
    expect(links.find((l) => l.id === "impact")?.href).toBe("/business?tab=impact&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = grantReportRelatedLinks("org-1", {
      active: "grants",
      include: ["grant-workbench", "impact"],
    });
    expect(links.map((l) => l.id)).toEqual(["grant-workbench", "impact"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(grantReportRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("grantReportNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = grantReportNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "grants")).toBe(true);
    expect(actions.some((a) => a.id === "impact")).toBe(true);
  });

  it("setup with org points at Workspace + Grants / Impact", () => {
    const actions = grantReportNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "grants")).toBe(true);
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty shells at Grants / Impact", () => {
    const actions = grantReportNextActions({
      orgId: "org-1",
      shell: "empty",
      eligibleCount: 0,
      reportCount: 0,
    });
    expect(actions[0]?.id).toBe("grants");
    expect(actions[0]?.href).toBe("/business?tab=grants&orgId=org-1");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["grants", "grant-workbench", "impact"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready shells prioritize generate without DEMO metrics", () => {
    const actions = grantReportNextActions({
      orgId: "org-1",
      shell: "ready",
      eligibleCount: 2,
      reportCount: 1,
    });
    expect(actions[0]?.id).toBe("generate");
    expect(actions.some((a) => a.id === "review-reports")).toBe(true);
    expect(actions.some((a) => a.id === "grants")).toBe(true);
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyGrantReportShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyGrantReportShell({ loading: true })).toBe("loading");
    expect(classifyGrantReportShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyGrantReportShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyGrantReportShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyGrantReportShell({
        loading: false,
        orgId: "o1",
        status: "live",
        eligibleCount: 0,
        reportCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyGrantReportShell({
        loading: false,
        orgId: "o1",
        status: "live",
        eligibleCount: 1,
        reportCount: 0,
      }),
    ).toBe("ready");
  });
});

describe("grantReportShellCopy + format helpers", () => {
  it("refuses invented DEMO grant dollars in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = grantReportShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(grantReportShellCopy("empty").description);
    expectPlainCopy(grantReportShellCopy("setup").description);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatGrantReportMetric(null, false)).toBe("…");
    expect(formatGrantReportMetric(3, true)).toBe("3");
    expect(formatGrantReportUsd(1200, true)).toBe("$1,200");
    expect(formatGrantReportUsd(1200, false)).toBe("—");
    expect(shouldShowGrantReportSummaryTiles({ eligibleCount: 0, reportCount: 0 })).toBe(false);
    expect(shouldShowGrantReportSummaryTiles({ eligibleCount: 1, reportCount: 0 })).toBe(true);
  });
});
