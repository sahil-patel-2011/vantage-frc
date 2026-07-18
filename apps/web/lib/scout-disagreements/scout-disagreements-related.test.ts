import { describe, expect, it } from "vitest";
import {
  SCOUT_DISAGREEMENTS_RELATED_INCLUDE,
  classifyScoutDisagreementsShell,
  formatScoutDisagreementsMetric,
  isScoutDisagreementsQueueEmpty,
  scoutDisagreementsNextActions,
  scoutDisagreementsRelatedLinks,
  scoutDisagreementsSetupSteps,
  scoutDisagreementsShellCopy,
  shouldShowScoutDisagreementsSummaryTiles,
} from "./scout-disagreements-related";

describe("scoutDisagreementsRelatedLinks", () => {
  it("builds Scouting / Accuracy / Coverage via hubHref / withOrgHref", () => {
    const links = scoutDisagreementsRelatedLinks("org-1", {
      include: [...SCOUT_DISAGREEMENTS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "accuracy", "coverage"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "accuracy")?.href).toBe("/scout-accuracy?orgId=org-1");
    expect(links.find((l) => l.id === "coverage")?.href).toBe("/scouting/lineup?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scoutDisagreementsRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("scoutDisagreementsSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO conflicts", () => {
    const steps = scoutDisagreementsSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "accuracy")?.href).toBe("/scout-accuracy?orgId=org-1");
    expect(steps.find((s) => s.id === "coverage")?.href).toBe("/scouting/lineup?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Scout Disagreements Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatScoutDisagreementsMetric(3, true)).toBe("3");
    expect(formatScoutDisagreementsMetric(0, false)).toBe("…");
    expect(formatScoutDisagreementsMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without real conflicts", () => {
    expect(
      shouldShowScoutDisagreementsSummaryTiles({
        totalOpen: 0,
        totalResolved: 0,
        totalDismissed: 0,
      }),
    ).toBe(false);
    expect(
      shouldShowScoutDisagreementsSummaryTiles({
        totalOpen: 2,
        totalResolved: 0,
        totalDismissed: 0,
      }),
    ).toBe(true);
  });

  it("treats zero items as empty", () => {
    expect(isScoutDisagreementsQueueEmpty({ itemCount: 0 })).toBe(true);
    expect(isScoutDisagreementsQueueEmpty({ itemCount: 2 })).toBe(false);
  });
});

describe("classifyScoutDisagreementsShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO conflicts", () => {
    expect(classifyScoutDisagreementsShell({ loading: true })).toBe("loading");
    expect(classifyScoutDisagreementsShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyScoutDisagreementsShell({ status: "setup_required" })).toBe("setup");
    expect(classifyScoutDisagreementsShell({ orgId: null, status: "live" })).toBe("setup");
    expect(
      classifyScoutDisagreementsShell({
        orgId: "o",
        status: "live",
        itemCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyScoutDisagreementsShell({
        orgId: "o",
        status: "live",
        itemCount: 3,
      }),
    ).toBe("ready");
  });
});

describe("scoutDisagreementsShellCopy", () => {
  it("refuses invented DEMO conflicts in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = scoutDisagreementsShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(scoutDisagreementsShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(scoutDisagreementsShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("scoutDisagreementsNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = scoutDisagreementsNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "accuracy")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
  });

  it("setup with org points at Scouting / Accuracy / Coverage", () => {
    const actions = scoutDisagreementsNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions.some((a) => a.id === "accuracy")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at Scouting / Accuracy / Coverage", () => {
    const actions = scoutDisagreementsNextActions({
      orgId: "org-1",
      shell: "empty",
      itemCount: 0,
    });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["accuracy", "coverage", "command"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready queues prioritize open conflicts without DEMO rows", () => {
    const actions = scoutDisagreementsNextActions({
      orgId: "org-1",
      shell: "ready",
      itemCount: 4,
      openCount: 2,
    });
    expect(actions[0]?.id).toBe("queue");
    expect(actions[0]?.href).toBe("#disagreement-queue");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "accuracy")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
