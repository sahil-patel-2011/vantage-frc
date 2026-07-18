import { describe, expect, it } from "vitest";
import {
  PIT_RELATED_INCLUDE,
  classifyPitShell,
  formatPitBatteryReady,
  formatPitMetric,
  isPitBoardEmpty,
  pitNextActions,
  pitRelatedLinks,
  pitSetupSteps,
  pitShellCopy,
  shouldShowPitSummaryTiles,
} from "./pit-related";

describe("pitRelatedLinks", () => {
  it("builds Batteries / Match checklist / Event Day cross-links via hubHref / withOrgHref", () => {
    const links = pitRelatedLinks("org-1", {
      include: [...PIT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["batteries", "match-checklist", "command"]);
    expect(links.find((l) => l.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(links.find((l) => l.id === "match-checklist")?.href).toBe(
      "/competition?tab=match-checklist&orgId=org-1",
    );
    expect(links.find((l) => l.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = pitRelatedLinks("org-1", {
      active: "batteries",
      include: ["match-checklist", "command"],
    });
    expect(links.map((l) => l.id)).toEqual(["match-checklist", "command"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(pitRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("pitSetupSteps", () => {
  it("points setup at Workspace + Batteries / Match checklist / Event Day", () => {
    const steps = pitSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual([
      "workspace",
      "batteries",
      "match-checklist",
      "command",
    ]);
    expect(steps.find((s) => s.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(steps.find((s) => s.id === "match-checklist")?.href).toBe(
      "/competition?tab=match-checklist&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
  });
});

describe("pitNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = pitNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "match-checklist")).toBe(true);
    expect(actions.some((a) => a.id === "command")).toBe(true);
  });

  it("setup with org points at Workspace + Batteries / Match checklist / Event Day", () => {
    const actions = pitNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "match-checklist")).toBe(true);
    expect(actions.some((a) => a.id === "command")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at log-battery + Batteries / Match checklist / Event Day", () => {
    const actions = pitNextActions({
      orgId: "org-1",
      shell: "empty",
      batteryCount: 0,
      openIssues: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["log-battery", "batteries", "match-checklist", "command"]),
    );
    expect(actions[0]?.href).toBe("#pit-actions");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize open issues without DEMO counts", () => {
    const actions = pitNextActions({
      orgId: "org-1",
      shell: "ready",
      batteryCount: 4,
      openIssues: 2,
      overdueMaintenance: 1,
    });
    expect(actions[0]?.id).toBe("open-issues");
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "match-checklist")).toBe(true);
    expect(actions.some((a) => a.id === "command")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyPitShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyPitShell({ loading: true })).toBe("loading");
    expect(classifyPitShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyPitShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe("error");
    expect(
      classifyPitShell({
        loading: false,
        orgId: "o1",
        batteryCount: 0,
        openIssues: 0,
        maintenanceCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyPitShell({
        loading: false,
        orgId: "o1",
        batteryCount: 2,
        openIssues: 0,
        maintenanceCount: 0,
      }),
    ).toBe("ready");
  });
});

describe("pitShellCopy + metrics", () => {
  it("refuses invented DEMO release / IR metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = pitShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent/i);
    }
    expect(pitShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(pitShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides zeroed tiles", () => {
    expect(formatPitMetric(null, false)).toBe("…");
    expect(formatPitMetric(3, true)).toBe("3");
    expect(formatPitMetric(-1, true)).toBe("0");
    expect(formatPitBatteryReady(1, 0, true)).toBe("—");
    expect(formatPitBatteryReady(1, 3, true)).toBe("1/3");
    expect(isPitBoardEmpty({ batteryCount: 0, openIssues: 0, maintenanceCount: 0 })).toBe(true);
    expect(shouldShowPitSummaryTiles({ batteryCount: 0, openIssues: 0, maintenanceCount: 0 })).toBe(
      false,
    );
    expect(shouldShowPitSummaryTiles({ batteryCount: 1, openIssues: 0, maintenanceCount: 0 })).toBe(
      true,
    );
  });
});
