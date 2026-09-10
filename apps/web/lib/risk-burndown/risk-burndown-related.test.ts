import { describe, expect, it } from "vitest";
import {
  RISK_BURNDOWN_RELATED_INCLUDE,
  classifyRiskBurndownShell,
  formatRiskBurndownMetric,
  riskBurndownNextActions,
  riskBurndownRelatedLinks,
  riskBurndownShellCopy,
  shouldShowRiskBurndownSummaryTiles,
} from "./risk-burndown-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("riskBurndownRelatedLinks", () => {
  it("builds Risks / FMEA cross-links via hubHref / withOrgHref", () => {
    const links = riskBurndownRelatedLinks("org-1", {
      include: [...RISK_BURNDOWN_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["risks", "fmea"]);
    expect(links.find((l) => l.id === "risks")?.href).toBe("/risks?orgId=org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/team?tab=fmea&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = riskBurndownRelatedLinks("org-1", {
      active: "risks",
      include: ["risks", "fmea"],
    });
    expect(links.map((l) => l.id)).toEqual(["fmea"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(riskBurndownRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("riskBurndownNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = riskBurndownNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "risks")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
  });

  it("setup with org points at Workspace + Risks / FMEA", () => {
    const actions = riskBurndownNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "risks")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at log-risk + Risks / FMEA", () => {
    const actions = riskBurndownNextActions({
      orgId: "org-1",
      shell: "empty",
      riskCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(expect.arrayContaining(["log-risk", "risks", "fmea"]));
    expect(actions[0]?.href).toBe("#risk-burndown-log-risk");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize high-severity / Risks without DEMO counts", () => {
    const actions = riskBurndownNextActions({
      orgId: "org-1",
      shell: "ready",
      riskCount: 4,
      openRiskCount: 2,
      highSeverityOpenCount: 1,
    });
    expect(actions[0]?.id).toBe("high-severity");
    expect(actions.some((a) => a.id === "risks")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyRiskBurndownShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyRiskBurndownShell({ loading: true })).toBe("loading");
    expect(classifyRiskBurndownShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyRiskBurndownShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyRiskBurndownShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyRiskBurndownShell({
        loading: false,
        orgId: "o1",
        status: "live",
        riskCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyRiskBurndownShell({
        loading: false,
        orgId: "o1",
        status: "live",
        riskCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("riskBurndownShellCopy + formatRiskBurndownMetric", () => {
  it("refuses invented DEMO risk metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = riskBurndownShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(riskBurndownShellCopy("empty").description);
    expectPlainCopy(riskBurndownShellCopy("setup").description);
  });

  it("formats real counts only and hides zeroed tiles", () => {
    expect(formatRiskBurndownMetric(null, false)).toBe("…");
    expect(formatRiskBurndownMetric(3, true)).toBe("3");
    expect(formatRiskBurndownMetric(-1, true)).toBe("0");
    expect(shouldShowRiskBurndownSummaryTiles(0)).toBe(false);
    expect(shouldShowRiskBurndownSummaryTiles(1)).toBe(true);
  });
});
