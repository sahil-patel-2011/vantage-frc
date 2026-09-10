import { describe, expect, it } from "vitest";
import {
  PIT_REPAIR_TRIAGE_RELATED_INCLUDE,
  classifyPitRepairTriageShell,
  formatPitRepairTriageMetric,
  pitRepairTriageNextActions,
  pitRepairTriageRelatedLinks,
  pitRepairTriageShellCopy,
  shouldShowPitRepairTriageSummaryTiles,
} from "./pit-repair-triage-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("pitRepairTriageRelatedLinks", () => {
  it("builds Command / FMEA / Spare Kit cross-links", () => {
    const links = pitRepairTriageRelatedLinks("org-1", {
      include: [...PIT_REPAIR_TRIAGE_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "fmea", "spare-robot-kit"]);
    expect(links.find((l) => l.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(pitRepairTriageRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("pitRepairTriageNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = pitRepairTriageNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("points empty boards at log-failure", () => {
    const actions = pitRepairTriageNextActions({
      orgId: "org-1",
      shell: "empty",
      reportCount: 0,
    });
    expect(actions[0]?.id).toBe("log-failure");
  });

  it("ready boards prioritize open triage without DEMO", () => {
    const actions = pitRepairTriageNextActions({
      orgId: "org-1",
      shell: "ready",
      reportCount: 4,
      openCount: 2,
    });
    expect(actions[0]?.id).toBe("resolve-open");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("prioritizes I104 reinspection when a fix/swap is still open", () => {
    const actions = pitRepairTriageNextActions({
      orgId: "org-1",
      shell: "ready",
      reportCount: 2,
      openCount: 1,
      reinspectReports: [{ subsystemName: "Intake", decision: "fix", status: "open" }],
    });
    expect(actions[0]?.id).toBe("reinspect");
    expect(actions[0]?.label).toContain("Intake");
    expect(actions[0]?.detail).toMatch(/I104/);
    expect(actions[0]?.detail.toLowerCase()).not.toContain("demo");
  });
});

describe("classifyPitRepairTriageShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyPitRepairTriageShell({ loading: true })).toBe("loading");
    expect(classifyPitRepairTriageShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyPitRepairTriageShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyPitRepairTriageShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        reportCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyPitRepairTriageShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        reportCount: 2,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatPitRepairTriageMetric(3, true)).toBe("3");
    expect(shouldShowPitRepairTriageSummaryTiles(0, 0, 0)).toBe(false);
    expect(shouldShowPitRepairTriageSummaryTiles(0, 1, 0)).toBe(true);
  });

  it("copy never invents DEMO triage calls", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = pitRepairTriageShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
